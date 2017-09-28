const fs = require('fs');
const environmentConfig = require('../deployment/environment.config.js');
const path = require('path');
const rpc = require('../utils/rpc.js');
const solc = require('solc');
const Web3 = require('web3');

const environment = 'development';
const config = environmentConfig[environment];
const web3 = new Web3(new Web3.providers.HttpProvider(`http://${config.host}:${config.port}`));

// TODO: factor out into a module
function getPlaceholderFromPath(libPath) {
  const libContractName = path.basename(libPath);
  let modifiedPath = libPath.replace('out', 'src');
  modifiedPath = `${modifiedPath}.sol:${libContractName}`;
  return modifiedPath.slice(0, 36);
}

describe('Fund shares', async () => {
  let accounts;
  let datafeed;
  let ethToken;
  let eurToken;
  let fund;
  let investor;
  let mlnToken;
  let opts;
  let participation;
  let rewards;
  let riskManagement;
  let simpleAdapter;
  let simpleMarket;
  let sphere;
  // mock data
  let mockAddress;
  const someBytes = '0x86b5eed81db5f691c36cc83eb58cb5205bd2090bf3763a19f0c5bf2f074dd84b';
  const wantedShares = 10000;
  const offeredValue = 10000;
  const incentive = 100;

  beforeAll(async () => {
    accounts = await web3.eth.getAccounts();
    opts = { from: accounts[0], gas: config.gas };
    investor = accounts[2];
    mockAddress = accounts[5];
    // deploy supporting contracts
    let abi;
    let bytecode;
    abi = JSON.parse(fs.readFileSync('./out/assets/Asset.abi'));
    bytecode = fs.readFileSync('./out/assets/Asset.bin');
    ethToken = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: ['Ether token', 'ETH-T', 18],
    }).send(opts));
    console.log('Deployed ether token');

    mlnToken = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: ['Melon token', 'MLN-T', 18],
    }).send(opts));
    console.log('Deployed melon token');

    eurToken = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: ['Euro token', 'EUR-T', 18],
    }).send(opts));
    console.log('Deployed euro token');

    abi = JSON.parse(fs.readFileSync('out/datafeeds/DataFeed.abi'));
    bytecode = fs.readFileSync('out/datafeeds/DataFeed.bin');
    datafeed = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [
        mlnToken.options.address,
        config.protocol.datafeed.interval,
        config.protocol.datafeed.validity
      ],
    }).send(opts));
    console.log('Deployed datafeed');

    abi = JSON.parse(fs.readFileSync('out/exchange/thirdparty/SimpleMarket.abi'));
    bytecode = fs.readFileSync('out/exchange/thirdparty/SimpleMarket.bin');
    simpleMarket = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [],
    }).send(opts));
    console.log('Deployed simple market');

    abi = JSON.parse(fs.readFileSync('out/sphere/Sphere.abi'));
    bytecode = fs.readFileSync('out/sphere/Sphere.bin');
    sphere = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [
        datafeed.options.address,
        simpleMarket.options.address
      ],
    }).send(opts));
    console.log('Deployed sphere');

    abi = JSON.parse(fs.readFileSync('out/riskmgmt/RiskMgmt.abi'));
    bytecode = fs.readFileSync('out/riskmgmt/RiskMgmt.bin');
    riskManagement = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [],
    }).send(opts));
    console.log('Deployed risk management');

    abi = JSON.parse(fs.readFileSync('out/participation/Participation.abi'));
    bytecode = fs.readFileSync('out/participation/Participation.bin');
    participation = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [],
    }).send(opts));
    console.log('Deployed participation');

    abi = JSON.parse(fs.readFileSync('out/exchange/adapter/simpleAdapter.abi'));
    bytecode = fs.readFileSync('out/exchange/adapter/simpleAdapter.bin');
    simpleAdapter = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [],
    }).send(opts));
    console.log('Deployed simple adapter');

    abi = JSON.parse(fs.readFileSync('out/libraries/rewards.abi'));
    bytecode = fs.readFileSync('out/libraries/rewards.bin');
    rewards = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [],
    }).send(opts));
    console.log('Deployed rewards library');

    // register assets
    await datafeed.methods.register(
      ethToken.options.address, '', '', 18, '', 
      someBytes, someBytes, mockAddress, mockAddress
    ).send(opts);
    await datafeed.methods.register(
      eurToken.options.address, '', '', 18, '',
      someBytes, someBytes, mockAddress, mockAddress
    ).send(opts);
    await datafeed.methods.register(
      mlnToken.options.address, '', '', 18, '',
      someBytes, someBytes, mockAddress, mockAddress
    ).send(opts);
    await datafeed.methods.update(
      [ethToken.options.address, eurToken.options.address, mlnToken.options.address],
      [1000000000000000000, 5091131249363608, 226244343891402714],  // mock data
    ).send(opts);
    console.log('Done registration and updates');

    // TODO: fix out of gas error when deploying Fund
    abi = JSON.parse(fs.readFileSync('out/Fund.abi'));
    bytecode = fs.readFileSync('out/Fund.bin', 'utf8');
    const libObject = {};
    libObject[getPlaceholderFromPath('out/libraries/rewards')] = rewards.options.address;
    libObject[getPlaceholderFromPath('out/exchange/adapter/simpleAdapter')] = simpleAdapter.options.address;
    bytecode = solc.linkBytecode(bytecode, libObject);
    fund = await (new web3.eth.Contract(abi).deploy({
      data: `0x${bytecode}`,
      arguments: [
        accounts[0],
        'Melon Portfolio',  // name
        'MLN-P',            // share symbol
        18,                 // share decimals
        0,                  // mgmt reward
        0,                  // perf reward
        mlnToken.options.address,
        participation.options.address,
        riskManagement.options.address,
        sphere.options.address,
      ],
    }).send(opts));
    console.log(fund);
    console.log('Deployed fund');
 
    participation.methods.attestForIdentity(investor).send(opts);   // whitelist investor
  });

  // convenience functions
  function timeout(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function simulateFeedUpdate() {
    await rpc.mineBlock();
    await timeout(3000);
    await datafeed.methods.update(
      [ethToken.options.address, eurToken.options.address, mlnToken.options.address],
      [10 ** 18, 10 ** 18, 10 ** 18],
    ).send(opts);
  }

  it('initial calculations', async () => {
    const [gav, , , unclaimedRewards, nav, sharePrice] = Object.values(await fund.methods.performCalculations.send(opts));

    expect(Number(gav)).toEqual(0);
    expect(Number(unclaimedRewards)).toEqual(0);
    expect(Number(nav)).toEqual(0);
    expect(Number(sharePrice)).toEqual(10 ** 18);
  });
  it('investor receives token from liquidity provider', async () => {
    const inputAmount = offeredValue + incentive;
    await mlnToken.methods.transfer(
      investor, inputAmount
    ).send(opts);
    const investorMlnBalance = await mlnToken.balanceOf(investor).call();

    expect(Number(investorMlnBalance)).toEqual(inputAmount);
  });
  it('allows subscribe request', async () => {
    const inputAllowance = offeredValue + incentive;
    await mlnToken.methods.approve(
      fund.options.address, inputAllowance
    ).send({from: investor});
    const investorAllowance = await mlnToken.methods.allowance(investor, fund.address).call();
    const subscriptionRequest = async () => {
      await fund.requestSubscription(
        wantedShares, offeredValue, incentive
      ).send({from: investor});
    }

    expect(Number(investorAllowance)).toEqual(inputAllowance);
    expect(subscriptionRequest).not.toThrow();
  });
  it('logs request event', async () => {
    const events = await fund.getPastEvents('SubscribeRequest');

    expect(events.length).toEqual(1);
  });
  it('allows execution of subscribe request', async () => {
    await simulateFeedUpdate();
    await simulateFeedUpdate();
    const requestId = await fund.methods.getLastRequestId().call();
    await fund.executeRequest(requestId);
    const investorBalance = await fund.methods.balanceOf(investor).call();

    expect(Number(investorBalance)).toEqual(wantedShares);
  });
  it('logs share creation', async () => {
    const events = await fund.getPastEvents('Subscribed');

    expect(events.length).toEqual(1);
  });
  it('performs calculation correctly', async () => {
    await simulateFeedUpdate();
    const [gav, , , unclaimedRewards, nav, sharePrice] = Object.values(
      await fund.methods.performCalculations().call()
    );

    expect(Number(gav)).toEqual(offeredValue);
    expect(Number(unclaimedRewards)).toEqual(0);
    expect(Number(nav)).toEqual(offeredValue);
    expect(Number(sharePrice)).toEqual(10 ** 18);
  });
});
