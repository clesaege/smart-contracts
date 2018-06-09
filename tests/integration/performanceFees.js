/* eslint no-underscore-dangle: ["error", { "allow": ["_pollTransactionReceipt"] }] */
import test from "ava";
import api from "../../utils/lib/api";
import { retrieveContract } from "../../utils/lib/contracts";
import deployEnvironment from "../../utils/deploy/contracts";
import calcSharePriceAndAllocateFees from "../../utils/lib/calcSharePriceAndAllocateFees";
import getAllBalances from "../../utils/lib/getAllBalances";
import { getTermsSignatureParameters } from "../../utils/lib/signing";
import { updateCanonicalPriceFeed } from "../../utils/lib/updatePriceFeed";

const BigNumber = require("bignumber.js");
const environmentConfig = require("../../utils/config/environment.js");

const environment = "development";
const config = environmentConfig[environment];

BigNumber.config({ ERRORS: false });

// TODO: factor out redundant assertions
// TODO: factor out tests into multiple files
// Using contract name directly instead of nameContract as in other tests as they are already deployed
let accounts;
let deployer;
let gasPrice;
let manager;
let investor;
let opts;
let mlnToken;
let ethToken;
let txId;
let runningGasTotal;
let fund;
let version;
let pricefeed;
let deployed;
let atLastUnclaimedFeeAllocation;

BigNumber.config({ ERRORS: false });

test.before(async () => {
  deployed = await deployEnvironment(environment);
  accounts = await api.eth.accounts();
  [deployer, manager, investor] = accounts;
  version = deployed.Version;
  pricefeed = await deployed.CanonicalPriceFeed;
  mlnToken = deployed.MlnToken;
  ethToken = deployed.EthToken;
  gasPrice = Number(await api.eth.gasPrice());
  opts = { from: deployer, gas: config.gas, gasPrice: config.gasPrice };
});

test.beforeEach(() => {
  runningGasTotal = new BigNumber(0);
});

// Setup
// For unique fundName on each test run
const fundName = "MelonPortfolio";
test.serial("can set up new fund", async t => {
  const preManagerEth = new BigNumber(await api.eth.getBalance(manager));
  const [r, s, v] = await getTermsSignatureParameters(manager);
  txId = await version.instance.setupFund.postTransaction(
    { from: manager, gas: config.gas, gasPrice: config.gasPrice },
    [
      fundName, // name
      ethToken.address, // base asset
      config.protocol.fund.managementFee,
      config.protocol.fund.performanceFee,
      20,
      deployed.NoCompliance.address,
      deployed.RMMakeOrders.address,
      [deployed.MatchingMarket.address],
      [mlnToken.address],
      v,
      r,
      s,
    ],
  );
  const block = await api.eth.getTransactionReceipt(txId);
  const timestamp = (await api.eth.getBlockByNumber(block.blockNumber))
    .timestamp;
  atLastUnclaimedFeeAllocation = new Date(timestamp).valueOf();
  await version._pollTransactionReceipt(txId);

  // Since postTransaction returns transaction hash instead of object as in Web3
  const gasUsed = (await api.eth.getTransactionReceipt(txId)).gasUsed;
  runningGasTotal = runningGasTotal.plus(gasUsed);
  const fundId = await version.instance.getLastFundId.call({}, []);
  const fundAddress = await version.instance.getFundById.call({}, [fundId]);
  fund = await retrieveContract("Fund", fundAddress);
  const postManagerEth = new BigNumber(await api.eth.getBalance(manager));
  // Change competition address to investor just for testing purpose so it allows invest / redeem
  await deployed.CompetitionCompliance.instance.changeCompetitionAddress.postTransaction(
    { from: deployer, gas: config.gas, gasPrice: config.gasPrice },
    [investor],
  );

  t.deepEqual(
    postManagerEth,
    preManagerEth.minus(runningGasTotal.times(gasPrice)),
  );
  t.deepEqual(Number(fundId), 0);
  // t.deepEqual(postManagerEth, preManagerEth.minus(runningGasTotal.times(gasPrice)));
});

test.serial("initial calculations", async t => {
  await updateCanonicalPriceFeed(deployed);
  const [
    gav,
    managementFee,
    performanceFee,
    unclaimedFees,
    feesShareQuantity,
    nav,
    sharePrice,
  ] = Object.values(await fund.instance.performCalculations.call(opts, ["0x0000000000000000000000000000000000000000", false]));

  t.deepEqual(Number(gav), 0);
  t.deepEqual(Number(managementFee), 0);
  t.deepEqual(Number(performanceFee), 0);
  t.deepEqual(Number(unclaimedFees), 0);
  t.deepEqual(Number(feesShareQuantity), 0);
  t.deepEqual(Number(nav), 0);
  t.deepEqual(Number(sharePrice), 10 ** 18);
});
const initialTokenAmount = new BigNumber(10 ** 23);
test.serial("investor receives initial mlnToken for testing", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  const preDeployerEth = new BigNumber(await api.eth.getBalance(deployer)); // TODO: this is now in getAllBalances
  txId = await mlnToken.instance.transfer.postTransaction(
    { from: deployer, gasPrice: config.gasPrice },
    [investor, initialTokenAmount, ""],
  );
  const gasUsed = (await api.eth.getTransactionReceipt(txId)).gasUsed;
  runningGasTotal = runningGasTotal.plus(gasUsed);
  const postDeployerEth = new BigNumber(await api.eth.getBalance(deployer));
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(
    postDeployerEth.toString(),
    preDeployerEth.minus(runningGasTotal.times(gasPrice)).toString(),
  );
  t.deepEqual(
    post.investor.MlnToken,
    pre.investor.MlnToken.add(initialTokenAmount),
  );

  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken);
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken);
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

// investment
// TODO: reduce code duplication between this and subsequent tests
// split first and subsequent tests due to differing behaviour
const firstTest = { wantedShares: new BigNumber(2000) };

const subsequentTests = [
  { wantedShares: new BigNumber(10 ** 18) },
  { wantedShares: new BigNumber(0.5 * 10 ** 18) },
];

async function calculateOfferValue(wantedShares) {
  // new
  const [
    ,
    invertedPrice,
    assetDecimals
  ] = await pricefeed.instance.getInvertedPriceInfo.call({}, [
    mlnToken.address
  ]);
  const sharePrice = await fund.instance.calcSharePrice.call({}, []);
  const sharesWorth = await fund.instance.toWholeShareUnit.call({}, [sharePrice.mul(wantedShares)]);
  return new BigNumber(Math.floor(sharesWorth.mul(invertedPrice).div(10 ** assetDecimals)));
}

test.serial("allows request and execution on the first investment", async t => {
  let investorGasTotal = new BigNumber(0);
  const pre = await getAllBalances(deployed, accounts, fund);
  const fundPreAllowance = await mlnToken.instance.allowance.call({}, [
    investor,
    fund.address,
  ]);
  const offerValue = await calculateOfferValue(firstTest.wantedShares);
  // Offer additional value than market price to avoid price fluctation failures
  firstTest.offeredValue = new BigNumber(Math.round(offerValue.mul(1.1)));
  const inputAllowance = firstTest.offeredValue;
  txId = await mlnToken.instance.approve.postTransaction(
    { from: investor, gasPrice: config.gasPrice },
    [fund.address, inputAllowance],
  );
  let gasUsed = (await api.eth.getTransactionReceipt(txId)).gasUsed;
  investorGasTotal = investorGasTotal.plus(gasUsed);
  const fundPostAllowance = await mlnToken.instance.allowance.call({}, [
    investor,
    fund.address,
  ]);
  txId = await fund.instance.requestInvestment.postTransaction(
    { from: investor, gas: config.gas, gasPrice: config.gasPrice },
    [firstTest.offeredValue, firstTest.wantedShares, mlnToken.address],
  );
  gasUsed = (await api.eth.getTransactionReceipt(txId)).gasUsed;

  investorGasTotal = investorGasTotal.plus(gasUsed);
  const investorPreShares = await fund.instance.balanceOf.call({}, [investor]);
  await updateCanonicalPriceFeed(deployed);
  await updateCanonicalPriceFeed(deployed);
  const requestedSharesTotalValue = await calculateOfferValue(firstTest.wantedShares);
  const offerRemainder = firstTest.offeredValue.minus(requestedSharesTotalValue);
  const requestId = await fund.instance.getLastRequestId.call({}, []);
  txId = await fund.instance.executeRequest.postTransaction(
    { from: investor, gas: config.gas, gasPrice: config.gasPrice },
    [requestId],
  );
  gasUsed = (await api.eth.getTransactionReceipt(txId)).gasUsed;
  investorGasTotal = investorGasTotal.plus(gasUsed);
  const investorPostShares = await fund.instance.balanceOf.call({}, [investor]);
  // reduce leftover allowance of investor to zero
  txId = await mlnToken.instance.approve.postTransaction(
    { from: investor, gasPrice: config.gasPrice },
    [fund.address, 0],
  );
  gasUsed = (await api.eth.getTransactionReceipt(txId)).gasUsed;
  investorGasTotal = investorGasTotal.plus(gasUsed);
  const remainingApprovedMln = Number(
    await mlnToken.instance.allowance.call({}, [investor, fund.address]),
  );
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(remainingApprovedMln, 0);
  t.deepEqual(
    investorPostShares,
    investorPreShares.add(firstTest.wantedShares),
  );
  t.deepEqual(fundPostAllowance, fundPreAllowance.add(inputAllowance));
  t.deepEqual(post.worker.MlnToken, pre.worker.MlnToken);
  t.deepEqual(post.worker.EthToken, pre.worker.EthToken);
  t.deepEqual(
    post.investor.MlnToken,
    pre.investor.MlnToken.minus(firstTest.offeredValue).add(offerRemainder),
  );

  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(
    post.investor.ether,
    pre.investor.ether.minus(investorGasTotal.times(gasPrice)),
  );
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(post.manager.ether, pre.manager.ether);
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken);
  t.deepEqual(
    post.fund.MlnToken,
    pre.fund.MlnToken.add(firstTest.offeredValue).minus(offerRemainder),
  );
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial("Performance fee deducted correctly", async t => {
  const [mlnPrice, ] = await pricefeed.instance.getPrice.call({}, [mlnToken.address]);
  const [ethPrice, ] = await pricefeed.instance.getPrice.call({}, [ethToken.address])
  await updateCanonicalPriceFeed(deployed, {
    [ethToken.address]: ethPrice,
    [mlnToken.address]: new BigNumber(mlnPrice).mul(3 * 10 ** 18).div(10 ** 18),
  });
});
