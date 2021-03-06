import test from "ava";
import api from "../../utils/lib/api";
import deployEnvironment from "../../utils/deploy/contracts";
import getAllBalances from "../../utils/lib/getAllBalances";
import {getSignatureParameters, getTermsSignatureParameters} from "../../utils/lib/signing";
import {updateCanonicalPriceFeed} from "../../utils/lib/updatePriceFeed";
import {deployContract, retrieveContract} from "../../utils/lib/contracts";
import governanceAction from "../../utils/lib/governanceAction";

const BigNumber = require("bignumber.js");
const environmentConfig = require("../../utils/config/environment.js");

const environment = "development";
const config = environmentConfig[environment];

// hoisted variables
let accounts;
let deployer;
let ethToken;
let fund;
let investor;
let manager;
let mlnToken;
let pricefeed;
let gasPrice;
let trade1;
let trade2;
let trade3;
let version;
let deployed;

// helper functions
async function getOrderHash(order, orderCreator, exchangeAddress) {
  const hashScheme = await api.util.sha3([
    "address Taker Token", "uint Taker Token Amount", "address Maker Token", "uint Maker Token",
    "uint Expires", "uint Nonce", "address Maker", "address Exchange"
  ].join(""));
  const innerHash =  await api.util.sha3([
    order.getAsset.substr(2),
    order.getQuantity.toString(16).padStart(64, '0'),
    order.giveAsset.substr(2),
    order.giveQuantity.toString(16).padStart(64, '0'),
    Number(order.expires).toString(16).padStart(64, '0'),
    Number(order.nonce).toString(16).padStart(64, '0'),
    orderCreator.substr(2),
    exchangeAddress.substr(2)
  ].join(""));
  const orderHash = await api.util.sha3([
    hashScheme.substr(2),
    innerHash.substr(2)
  ].join(""));
  return orderHash;
}

async function getOrderSignature(order, orderCreator, exchangeAddress, signer) {
  const orderHash = await getOrderHash(order, orderCreator, exchangeAddress);
  let [r, s, v] = await getSignatureParameters(signer, orderHash);
  const mode = Number(1).toString(16).padStart(2, '0');
  const fullSignature = "0x" + [
    mode,
    Number(v).toString(16).padStart(2, '0'),
    r.substr(2),
    s.substr(2)
  ].join("");

  const signatureObject = {
    mode,
    v,
    r,
    s,
    fullSignature
  };
  return signatureObject;
}

// declare function signatures
const makeOrderSignature = api.util.abiSignature('makeOrder', [
  'address', 'address[5]', 'uint256[8]', 'bytes32', 'uint8', 'bytes32', 'bytes32'
]).slice(0,10);
const takeOrderSignature = api.util.abiSignature('takeOrder', [
  'address', 'address[5]', 'uint256[8]', 'bytes32', 'uint8', 'bytes32', 'bytes32'
]).slice(0,10);
const cancelOrderSignature = api.util.abiSignature('cancelOrder', [
  'address', 'address[5]', 'uint256[8]', 'bytes32', 'uint8', 'bytes32', 'bytes32'
]).slice(0,10);

// mock data
const offeredValue = new BigNumber(10 ** 20);
const wantedShares = new BigNumber(10 ** 20);

test.before(async () => {
  deployed = await deployEnvironment(environment);
  accounts = await api.eth.accounts();
  [deployer, manager, investor, ,] = accounts;
  version = await deployed.Version;
  pricefeed = await deployed.CanonicalPriceFeed;
  mlnToken = await deployed.MlnToken;
  ethToken = await deployed.EthToken;
  deployed.DexyVault = await deployContract(
    "exchange/thirdparty/dexy/Vault",
    {from: deployer}
  );
  deployed.DexyExchange = await deployContract(
    "exchange/thirdparty/dexy/Exchange",
    { from: deployer },
    [0, deployer, deployed.DexyVault.address]
  );
  deployed.DexyAdapter = await deployContract(
    "exchange/adapter/DexyAdapter",
    { from: deployer }
  );
  await deployed.DexyVault.instance.setExchange.postTransaction(
    {from: deployer}, [deployed.DexyExchange.address]
  );
  await governanceAction(
    {from: deployer},
    deployed.Governance, deployed.CanonicalPriceFeed, 'registerExchange',
    [
      deployed.DexyExchange.address,
      deployed.DexyAdapter.address,
      false,
      [ makeOrderSignature, takeOrderSignature, cancelOrderSignature ]
    ]
  );

  const [r, s, v] = await getTermsSignatureParameters(manager);
  await version.instance.setupFund.postTransaction(
    { from: manager, gas: config.gas, gasPrice: config.gasPrice },
    [
      "Test Fund",
      deployed.MlnToken.address, // base asset
      config.protocol.fund.managementFee,
      config.protocol.fund.performanceFee,
      deployed.NoCompliance.address,
      deployed.RMMakeOrders.address,
      [deployed.DexyExchange.address],
      v,
      r,
      s,
    ],
  );
  const fundAddress = await version.instance.managerToFunds.call({}, [manager]);
  fund = await retrieveContract("Fund", fundAddress);
  gasPrice = await api.eth.gasPrice();

  await updateCanonicalPriceFeed(deployed);
  const [, referencePrice] = await pricefeed.instance.getReferencePriceInfo.call(
    {}, [mlnToken.address, ethToken.address]
  );
  const sellQuantity1 = new BigNumber(10 ** 19);
  trade1 = {
    giveAsset: ethToken.address,
    getAsset: mlnToken.address,
    giveQuantity: sellQuantity1,
    getQuantity: referencePrice.dividedBy(new BigNumber(10 ** 18)).times(sellQuantity1),
    expires: Math.floor((Date.now() / 1000) + 50000),
    nonce: 10
  };
  trade2 = {
    giveAsset: ethToken.address,
    getAsset: mlnToken.address,
    giveQuantity: sellQuantity1,
    getQuantity: referencePrice.dividedBy(new BigNumber(10 ** 18)).times(sellQuantity1),
    expires: Math.floor((Date.now() / 1000) + 50000),
    nonce: 11
  };
  trade3 = {
    giveAsset: mlnToken.address,
    getAsset: ethToken.address,
    giveQuantity: sellQuantity1,
    getQuantity: referencePrice.dividedBy(new BigNumber(10 ** 18)).times(sellQuantity1),
    expires: Math.floor((Date.now() / 1000) + 50000),
    nonce: 12
  };
});

// test.beforeEach(async () => {
//   await updateCanonicalPriceFeed(deployed);
// });

const initialTokenAmount = new BigNumber(10 ** 22);
test.serial("investor receives initial tokens for testing", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  await mlnToken.instance.transfer.postTransaction(
    { from: deployer, gasPrice: config.gasPrice },
    [investor, initialTokenAmount, ""]
  );
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(
    post.investor.MlnToken,
    new BigNumber(pre.investor.MlnToken).add(initialTokenAmount)
  );
  t.deepEqual( post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken);
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken);
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial("fund receives MLN from an investment", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  await mlnToken.instance.approve.postTransaction(
    { from: investor, gasPrice: config.gasPrice, gas: config.gas },
    [fund.address, offeredValue],
  );
  await fund.instance.requestInvestment.postTransaction(
    { from: investor, gas: config.gas, gasPrice: config.gasPrice },
    [offeredValue, wantedShares, mlnToken.address],
  );
  await updateCanonicalPriceFeed(deployed);
  await updateCanonicalPriceFeed(deployed);
  const requestId = await fund.instance.getLastRequestId.call({}, []);
  await fund.instance.executeRequest.postTransaction(
    { from: investor, gas: config.gas, gasPrice: config.gasPrice },
    [requestId],
  );
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(post.worker.MlnToken, pre.worker.MlnToken);
  t.deepEqual(post.worker.EthToken, pre.worker.EthToken);
  t.deepEqual(
    post.investor.MlnToken,
    pre.investor.MlnToken.minus(offeredValue),
  );
  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(post.manager.ether, pre.manager.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken.add(offeredValue));
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken);
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial("third party makes an on-chain order", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  let txid = await deployed.DexyVault.instance.approve.postTransaction(
    {from: deployer}, [deployed.DexyExchange.address]
  );
  let runningGasTotal = new BigNumber((await api.eth.getTransactionReceipt(txid)).gasUsed);
  txid = await ethToken.instance.approve.postTransaction(
    {from: deployer}, [deployed.DexyVault.address, trade1.giveQuantity]
  );
  runningGasTotal = runningGasTotal.plus((await api.eth.getTransactionReceipt(txid)).gasUsed);
  txid = await deployed.DexyVault.instance.deposit.postTransaction(
    {from: deployer}, [ethToken.address, trade1.giveQuantity]
  );
  runningGasTotal = runningGasTotal.plus((await api.eth.getTransactionReceipt(txid)).gasUsed);
  txid = await deployed.DexyExchange.instance.order.postTransaction(
    {from: deployer},
    [
      [trade1.giveAsset, trade1.getAsset],
      [trade1.giveQuantity, trade1.getQuantity, trade1.expires, trade1.nonce]
    ]
  );
  runningGasTotal = runningGasTotal.plus((await api.eth.getTransactionReceipt(txid)).gasUsed);
  const orderHash = await getOrderHash(trade1, deployer, deployed.DexyExchange.address);
  const isOrdered = await deployed.DexyExchange.instance.isOrdered.call({}, [deployer, orderHash]);
  const post = await getAllBalances(deployed, accounts, fund);

  t.true(isOrdered);
  t.deepEqual(post.investor.MlnToken, pre.investor.MlnToken);
  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.deployer.MlnToken, pre.deployer.MlnToken);
  t.deepEqual(post.deployer.EthToken, pre.deployer.EthToken.minus(trade1.giveQuantity));
  t.deepEqual(
    post.deployer.ether,
    pre.deployer.ether.minus(runningGasTotal.times(gasPrice))
  );
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken);
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken);
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial("manager takes on-chain order through dexy adapter", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  const sig = await getOrderSignature(trade1, deployer, deployed.DexyExchange.address, deployer);
  let txid = await fund.instance.callOnExchange.postTransaction(
    {from: manager, gas: config.gas},
    [
      0, takeOrderSignature,
      [deployer, "0x0", trade1.giveAsset, trade1.getAsset, "0x0"],
      [
        trade1.giveQuantity, trade1.getQuantity, 0, 0,
        trade1.expires, trade1.nonce, trade1.giveQuantity, sig.mode
      ],
      "0x0", sig.v, sig.r, sig.s
    ]
  );
  const managerGasTotal = (await api.eth.getTransactionReceipt(txid)).gasUsed;
  txid = await deployed.DexyVault.instance.withdraw.postTransaction(
    {from: deployer}, [trade1.getAsset, trade1.getQuantity]
  );
  const deployerGasTotal = (await api.eth.getTransactionReceipt(txid)).gasUsed;
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(post.investor.MlnToken, pre.investor.MlnToken);
  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.deployer.MlnToken, pre.deployer.MlnToken.plus(trade1.getQuantity));
  t.deepEqual(post.deployer.EthToken, pre.deployer.EthToken);
  t.deepEqual(
    post.deployer.ether,
    pre.deployer.ether.minus(deployerGasTotal.times(gasPrice))
  );
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(
    post.manager.ether,
    pre.manager.ether.minus(managerGasTotal.times(gasPrice))
  );
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken.minus(trade1.getQuantity));
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken.plus(trade1.giveQuantity));
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial("third party makes off-chain order, and manager takes it", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  let txid = await deployed.DexyVault.instance.approve.postTransaction(
    {from: deployer}, [deployed.DexyExchange.address]
  );
  let deployerGasTotal = (await api.eth.getTransactionReceipt(txid)).gasUsed;
  txid = await ethToken.instance.approve.postTransaction(
    {from: deployer},
    [deployed.DexyVault.address, trade2.giveQuantity]
  );
  deployerGasTotal = deployerGasTotal.plus(
    (await api.eth.getTransactionReceipt(txid)).gasUsed
  );
  txid = await deployed.DexyVault.instance.deposit.postTransaction(
    {from: deployer}, [ethToken.address, trade2.giveQuantity]
  );
  deployerGasTotal = deployerGasTotal.plus(
    (await api.eth.getTransactionReceipt(txid)).gasUsed
  );
  const sig = await getOrderSignature(trade2, deployer, deployed.DexyExchange.address, deployer);
  txid = await fund.instance.callOnExchange.postTransaction(
    {from: manager, gas: config.gas},
    [
      0, takeOrderSignature,
      [deployer, "0x0", trade2.giveAsset, trade2.getAsset, "0x0"],
      [
        trade2.giveQuantity, trade2.getQuantity, 0, 0,
        trade2.expires, trade2.nonce, trade2.giveQuantity, sig.mode
      ],
      "0x0", sig.v, sig.r, sig.s
    ]
  );
  const managerGasTotal = (await api.eth.getTransactionReceipt(txid)).gasUsed;
  txid = await deployed.DexyVault.instance.withdraw.postTransaction(
    {from: deployer}, [trade2.getAsset, trade2.getQuantity]
  );
  deployerGasTotal = deployerGasTotal.plus(
    (await api.eth.getTransactionReceipt(txid)).gasUsed
  );
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(post.investor.MlnToken, pre.investor.MlnToken);
  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.deployer.MlnToken, pre.deployer.MlnToken.plus(trade2.getQuantity));
  t.deepEqual(post.deployer.EthToken, pre.deployer.EthToken.minus(trade2.giveQuantity));
  t.deepEqual(
    post.deployer.ether,
    pre.deployer.ether.minus(deployerGasTotal.times(gasPrice))
  );
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(
    post.manager.ether,
    pre.manager.ether.minus(managerGasTotal.times(gasPrice))
  );
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken.minus(trade2.getQuantity));
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken.plus(trade2.giveQuantity));
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial("manager makes order through dexy adapter", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  const txid = await fund.instance.callOnExchange.postTransaction(
    {from: manager, gas: config.gas},
    [
      0, makeOrderSignature,
      [deployer, "0x0", trade3.giveAsset, trade3.getAsset, "0x0"],
      [
        trade3.giveQuantity, trade3.getQuantity, 0, 0,
        trade3.expires, trade3.nonce, trade3.giveQuantity, 0
      ],
      "0x0", 0, "0x0", "0x0"
    ]
  );
  const managerGasTotal = (await api.eth.getTransactionReceipt(txid)).gasUsed;
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(post.investor.MlnToken, pre.investor.MlnToken);
  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.deployer.MlnToken, pre.deployer.MlnToken);
  t.deepEqual(post.deployer.EthToken, pre.deployer.EthToken);
  t.deepEqual(post.deployer.ether, pre.deployer.ether);
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(
    post.manager.ether,
    pre.manager.ether.minus(managerGasTotal.times(gasPrice))
  );
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(
    post.fund.MlnToken,
    pre.fund.MlnToken.minus(trade3.giveQuantity)
  );
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken);
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial.skip("third party takes an order made by fund", async t => {
  const pre = await getAllBalances(deployed, accounts, fund);
  let txid = await deployed.DexyVault.instance.approve.postTransaction(
    {from: deployer}, [deployed.DexyExchange.address]
  );
  let deployerGasTotal = (await api.eth.getTransactionReceipt(txid)).gasUsed;
  txid = await ethToken.instance.approve.postTransaction(
    {from: deployer},
    [deployed.DexyVault.address, trade3.getQuantity]
  );
  deployerGasTotal = deployerGasTotal.plus(
    (await api.eth.getTransactionReceipt(txid)).gasUsed
  );
  txid = await deployed.DexyVault.instance.deposit.postTransaction(
    {from: deployer}, [ethToken.address, trade3.getQuantity]
  );
  deployerGasTotal = deployerGasTotal.plus(
    (await api.eth.getTransactionReceipt(txid)).gasUsed
  );
  const sig = await getOrderSignature(trade3, deployer, deployed.DexyExchange.address, deployer);
  txid = await deployed.DexyExchange.instance.trade.postTransaction(
    {from: deployer, gas: 6000000},
    [
      [fund.address, trade3.giveAsset, trade3.getAsset],
      [trade3.giveQuantity, trade3.getQuantity, trade3.expires, trade3.nonce],
      sig.fullSignature, trade3.giveQuantity
    ]
  );
  deployerGasTotal = deployerGasTotal.plus(
    (await api.eth.getTransactionReceipt(txid)).gasUsed
  );
  txid = await deployed.DexyVault.instance.withdraw.postTransaction(
    {from: deployer}, [trade3.giveAsset, trade3.giveQuantity]
  );
  deployerGasTotal = deployerGasTotal.plus(
    (await api.eth.getTransactionReceipt(txid)).gasUsed
  );
  const post = await getAllBalances(deployed, accounts, fund);

  t.deepEqual(post.investor.MlnToken, pre.investor.MlnToken);
  t.deepEqual(post.investor.EthToken, pre.investor.EthToken);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.deployer.MlnToken, pre.deployer.MlnToken.plus(trade3.giveQuantity));
  t.deepEqual(post.deployer.EthToken, pre.deployer.EthToken.minus(trade3.getQuantity));
  t.deepEqual(
    post.deployer.ether,
    pre.deployer.ether.minus(deployerGasTotal.times(gasPrice))
  );
  t.deepEqual(post.manager.EthToken, pre.manager.EthToken);
  t.deepEqual(post.manager.MlnToken, pre.manager.MlnToken);
  t.deepEqual(post.manager.ether, pre.manager.ether);
  t.deepEqual(post.investor.ether, pre.investor.ether);
  t.deepEqual(post.fund.MlnToken, pre.fund.MlnToken);
  t.deepEqual(post.fund.EthToken, pre.fund.EthToken.plus(trade3.giveQuantity));
  t.deepEqual(post.fund.ether, pre.fund.ether);
});

test.serial.skip("manager makes and cancels order through dexy adapter", async t => {
});
