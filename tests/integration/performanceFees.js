/* eslint no-underscore-dangle: ["error", { "allow": ["_pollTransactionReceipt"] }] */
import test from "ava";
import api from "../../utils/lib/api";
import { retrieveContract } from "../../utils/lib/contracts";
import deployEnvironment from "../../utils/deploy/contracts";
import calcSharePrice from "../../utils/lib/calcSharePrice";
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
let manager;
let investor;
let secondInvestor;
let opts;
let mlnToken;
let ethToken;
let txId;
let fund;
let version;
let pricefeed;
let deployed;
let atLastUnclaimedFeeAllocation;

BigNumber.config({ ERRORS: false });

async function requestAndExecute(from, offeredValue, wantedShares) {
  await ethToken.instance.approve.postTransaction(
    { from, gasPrice: config.gasPrice },
    [fund.address, offeredValue],
  );
  await fund.instance.requestInvestment.postTransaction(
    { from, gas: config.gas, gasPrice: config.gasPrice },
    [offeredValue, wantedShares, ethToken.address],
  );
  await updateCanonicalPriceFeed(deployed);
  await updateCanonicalPriceFeed(deployed);
  const requestId = await fund.instance.getLastRequestId.call({}, []);
  await fund.instance.executeRequest.postTransaction(
    { from: investor, gas: config.gas, gasPrice: config.gasPrice },
    [requestId],
  );
}

test.before(async () => {
  deployed = await deployEnvironment(environment);
  accounts = await api.eth.accounts();
  [deployer, manager, investor, secondInvestor] = accounts;
  version = deployed.Version;
  pricefeed = await deployed.CanonicalPriceFeed;
  mlnToken = deployed.MlnToken;
  ethToken = deployed.EthToken;
  opts = { from: deployer, gas: config.gas, gasPrice: config.gasPrice };
  await ethToken.instance.transfer.postTransaction(
    { from: deployer, gasPrice: config.gasPrice },
    [investor, 10 ** 25, ""],
  );
  await ethToken.instance.transfer.postTransaction(
    { from: deployer, gasPrice: config.gasPrice },
    [secondInvestor, 10 ** 25, ""],
  );
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
      0,
      //config.protocol.fund.managementFee,
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
  const fundId = await version.instance.getLastFundId.call({}, []);
  const fundAddress = await version.instance.getFundById.call({}, [fundId]);
  fund = await retrieveContract("Fund", fundAddress);
  const postManagerEth = new BigNumber(await api.eth.getBalance(manager));
  // Change competition address to investor just for testing purpose so it allows invest / redeem
  await deployed.CompetitionCompliance.instance.changeCompetitionAddress.postTransaction(
    { from: deployer, gas: config.gas, gasPrice: config.gasPrice },
    [investor],
  );

  t.deepEqual(Number(fundId), 0);
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

// investment
const firstTest = { wantedShares: new BigNumber(10 ** 19) };

const subsequentTests = [
  { wantedShares: new BigNumber(10 ** 18) },
  { wantedShares: new BigNumber(0.5 * 10 ** 18) },
];

async function calculateOfferValue(wantedShares) {
  const sharePrice = await fund.instance.calcSharePrice.call({}, []);
  return fund.instance.toWholeShareUnit.call({}, [sharePrice.mul(wantedShares)]);
}

test.serial("allows request and execution on the first investment", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  const offerValue = firstTest.wantedShares;
  // Offer additional value than market price to avoid price fluctation failures
  firstTest.offeredValue = offerValue;
  const investorPreShares = await fund.instance.balanceOf.call({}, [investor]);
  await requestAndExecute(investor, firstTest.offeredValue, firstTest.wantedShares);
  const investorPostShares = await fund.instance.balanceOf.call({}, [investor]);
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(
    investorPostShares,
    investorPreShares.add(firstTest.wantedShares),
  );
  t.deepEqual(post.worker.MlnToken, pre.worker.MlnToken);
  t.deepEqual(post.worker.EthToken, pre.worker.EthToken);
  t.deepEqual(
    post.investor.EthToken,
    pre.investor.EthToken.minus(firstTest.offeredValue),
  );

  t.deepEqual(post.investor.MlnToken, pre.investor.MlnToken);
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(post.manager.ether, pre.manager.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken);
  t.deepEqual(
    post.fund.EthToken,
    pre.fund.EthToken.add(firstTest.offeredValue),
  );
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial("artificially inflate share price", async t => {
  const preSharePrice = await fund.instance.calcSharePrice.call({}, []);
  await ethToken.instance.transfer.postTransaction(
    { from: deployer, gas: config.gas, gasPrice: config.gasPrice },
    [fund.address, firstTest.wantedShares],
  );
  const postSharePrice = await fund.instance.calcSharePrice.call({}, []);
  const gav = await fund.instance.calcGav.call({}, []);
  const [, managementFee] = await fund.instance.calcUnclaimedFees.call({}, [gav]);

  t.true(postSharePrice > preSharePrice);
  t.true(managementFee > 0);
});

test.serial("Redeem should give same quantity of invested asset", async t => {
  const offeredValue = await calculateOfferValue(firstTest.wantedShares);
  const initialInvestorEthToken = await ethToken.instance.balanceOf.call({}, [secondInvestor]);
  await requestAndExecute(secondInvestor, offeredValue, firstTest.wantedShares);
  const preInvestorEthToken = await ethToken.instance.balanceOf.call({}, [secondInvestor]);
  const consumedEthToken = initialInvestorEthToken.sub(preInvestorEthToken);
  /*
  const [gav, , , unclaimedFees, , sharePrice, highWaterMark] = Object.values(
    await fund.instance.atLastHighWaterMarkUpdate.call({}, []),
  );*/
  await fund.instance.redeemAllOwnedAssets.postTransaction(
    { from: secondInvestor, gas: config.gas, gasPrice: config.gasPrice },
    [firstTest.wantedShares],
  );
  const postInvestorEthToken = await ethToken.instance.balanceOf.call({}, [secondInvestor]);
  /*
  const [gav, managementFee, performanceFee, unclaimedFees, , sharePrice, highWaterMark] = Object.values(
    await fund.instance.atLastHighWaterMarkUpdate.call({}, []),
  );*/
  const redeemedEthToken = postInvestorEthToken.sub(preInvestorEthToken);
  const difference = redeemedEthToken.sub(consumedEthToken);
  console.log(difference);
  t.is(Number(difference), 0);

});


/*
test.serial("Performance fee deducted correctly", async t => {
  const [mlnPrice, ] = await pricefeed.instance.getPrice.call({}, [mlnToken.address]);
  const [ethPrice, ] = await pricefeed.instance.getPrice.call({}, [ethToken.address])
  await updateCanonicalPriceFeed(deployed, {
    [ethToken.address]: ethPrice,
    [mlnToken.address]: new BigNumber(mlnPrice).mul(3 * 10 ** 18).div(10 ** 18),
  });
});*/
