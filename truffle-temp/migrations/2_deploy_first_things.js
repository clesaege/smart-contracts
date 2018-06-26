/* eslint-disable */
// const ourConfig = require("./ourConfig.js");
const fs = require('fs');
require('web3');
// import * as masterConfig from "../../utils/config/environment";

const PreminedAsset = artifacts.require("PreminedAsset");
const Governance = artifacts.require("Governance");
const CanonicalPriceFeed = artifacts.require("CanonicalPriceFeed");
const StakingPriceFeed = artifacts.require("StakingPriceFeed");
const SimpleMarket = artifacts.require("SimpleMarket");
const SimpleAdapter = artifacts.require("SimpleAdapter");
const MatchingMarket = artifacts.require("MatchingMarket");
const MatchingMarketAdapter = artifacts.require("MatchingMarketAdapter");
const NoCompliance = artifacts.require("NoCompliance");
const RMMakeOrders = artifacts.require("RMMakeOrders");
const CentralizedAdapter = artifacts.require("CentralizedAdapter");
const CompetitionCompliance = artifacts.require("CompetitionCompliance");
const Version = artifacts.require("Version");
const FundRanking = artifacts.require("FundRanking");
const Competition = artifacts.require("Competition");

const tokenInfoFileName = "./tokenInfo.config";
const addressBookFile = "./addressBook.json";

const mockBytes = "0x86b5eed81db5f691c36cc83eb58cb5205bd2090bf3763a19f0c5bf2f074dd84b";
const mockAddress = "0x083c41ea13af6c2d5aaddf6e73142eb9a7b00183";


const config = {
  networkId: '*',
  host: 'localhost',
  port: 8545,
  gas: 8000000,
  gasPrice: 100000000000,
  protocol: {
    registrar: {
      assetsToRegister: [
        'ANT-T', 'BNT-T', 'BAT-T', 'BTC-T', 'DGD-T', 'DOGE-T', 'ETC-T', 'ETH-T', 'EUR-T',
        'GNO-T', 'GNT-T', 'ICN-T', 'LTC-T', 'REP-T', 'XRP-T', 'SNGLS-T', 'SNT-T'
      ],
    },
    pricefeed: {
      interval: 0,
      validity: 60,
      preEpochUpdatePeriod: 60,
      minimumUpdates: 1
    },
    fund: {
      managementFee: 0,
      performanceFee: 0
    },
    staking: {
      minimumAmount: 1000000,
      numOperators: 4,
      unstakeDelay: 0
    }
  },
};

module.exports = function(deployer, network, accounts) {
  deployer.then(async () => {
    // const config = masterConfig[network];
    const deployed = {};
    if (network === "development") {
      deployed.EthToken = await deployer.new(PreminedAsset);
      deployed.MlnToken = await deployer.new(PreminedAsset);
      deployed.EurToken = await deployer.new(PreminedAsset);
      deployed.Governance = await deployer.deploy(Governance, [accounts[0]], 1, 100000);
      deployed.CanonicalPriceFeed = await deployer.deploy(CanonicalPriceFeed, deployed.MlnToken.address,
        deployed.EthToken.address,
        mockBytes,
        '0x99ABD417',
        18,
        'ethereum.org',
        'asd',
        [mockAddress, mockAddress],
        [],
        [],
        [
          config.protocol.pricefeed.interval,
          config.protocol.pricefeed.validity
        ],
        [
          config.protocol.staking.minimumAmount,
          config.protocol.staking.numOperators,
          config.protocol.staking.unstakeDelay
        ],
        deployed.Governance.address,
        {gas: 100000000}
      );
      deployed.SimpleMarket = await deployer.deploy(SimpleMarket);
      deployed.SimpleAdapter = await deployer.deploy(SimpleAdapter);
      deployed.MatchingMarket= await deployer.deploy(MatchingMarket, 154630446100);
      deployed.MatchingMarketAdapter = await deployer.deploy(MatchingMarketAdapter);
      deployed.NoCompliance = await deployer.deploy(NoCompliance);
      deployed.RMMakeOrders = await deployer.deploy(RMMakeOrders);
      deployed.CentralizedAdapter = await deployer.deploy(CentralizedAdapter);
      deployed.CompetitionCompliance = await deployer.deploy(CompetitionCompliance, accounts[0]);
      deployed.Version = await deployer.deploy(Version, "2", deployed.Governance.address, deployed.MlnToken.address, deployed.EthToken.address, deployed.CanonicalPriceFeed.address, deployed.CompetitionCompliance.address);
      deployed.FundRanking = await deployer.deploy(FundRanking);
      deployed.StakingPriceFeed = await createStakingFeed(await CanonicalPriceFeed.deployed());

      const blockchainTime = Math.floor(new Date().valueOf() / 1000);
      deployed.Competition = await deployer.deploy(Competition, deployed.MlnToken.address, deployed.EurToken.address, deployed.EthToken.address, accounts[5], blockchainTime, blockchainTime + 8640000, 20 * 10 ** 18, 10 ** 23, 10, false);

      await deployed.CompetitionCompliance.changeCompetitionAddress(deployed.Competition.address);
      await deployed.Competition.batchAddToWhitelist(10 ** 25, [accounts[0], accounts[1], accounts[2]]);

      // whitelist trading pairs
      const pairsToWhitelist = [
        [deployed.MlnToken.address, deployed.EthToken.address],
        [deployed.EurToken.address, deployed.EthToken.address],
        [deployed.MlnToken.address, deployed.EurToken.address],
      ];
      await Promise.all(
        pairsToWhitelist.map(async (pair) => {
          await deployed.MatchingMarket.addTokenPairWhitelist(pair[0], pair[1]);
        })
      );

      // add Version to Governance tracking
      await governanceAction(deployed.Governance, deployed.Governance, 'addVersion', [deployed.Version.address]);

      // whitelist exchange
      const makeOrderSignature = web3.sha3('makeOrder(address,address[5],uint256[8],bytes32,uint8,bytes32,bytes32)').substr(0, 10);;
      const takeOrderSignature = web3.sha3('takeOrder(address,address[5],uint256[8],bytes32,uint8,bytes32,bytes32)').substr(0, 10);;
      const cancelOrderSignature = web3.sha3('cancelOrder(address,address[5],uint256[8],bytes32,uint8,bytes32,bytes32)').substr(0, 10);;

      await governanceAction(
        deployed.Governance, deployed.CanonicalPriceFeed, 'registerExchange',
        [
          deployed.MatchingMarket.address,
          deployed.MatchingMarketAdapter.address,
          true,
          [
            makeOrderSignature,
            takeOrderSignature,
            cancelOrderSignature
          ]
        ]
      );

      // register assets
      await governanceAction(deployed.Governance, deployed.CanonicalPriceFeed, 'registerAsset', [
        deployed.MlnToken.address,
        "Melon token",
        "MLN-T",
        18,
        "melonport.com",
        mockBytes,
        [mockAddress, mockAddress],
        [],
        []
      ]);
      await governanceAction(deployed.Governance, deployed.CanonicalPriceFeed, 'registerAsset', [
        deployed.EurToken.address,
        "Euro token",
        "EUR-T",
        18,
        "europa.eu",
        mockBytes,
        [mockAddress, mockAddress],
        [],
        []
      ]);
    }
    await writeToAddressBook(deployed, network)
  });
};

async function createStakingFeed(canonicalPriceFeed) {
  const receipt = await canonicalPriceFeed.setupStakingPriceFeed();
  const addr = receipt.logs.find(o => o.event === 'SetupPriceFeed').args.ofPriceFeed;
  return StakingPriceFeed.at(addr);
}

async function governanceAction(governance, target, methodName, methodArgs = [], value = 0) {
  const calldata = await target[methodName].request(...methodArgs).params[0].data;
  await governance.propose(target.address, calldata, value);
  const proposalId = await governance.actionCount.call();
  await governance.confirm(proposalId);  await governance.trigger(proposalId);
}

// takes `deployed` object as defined above, and environment to write to
async function writeToAddressBook(deployedContracts, environment) {
  let addressBook;
  if (fs.existsSync(addressBookFile)) {
    addressBook = JSON.parse(fs.readFileSync(addressBookFile));
  } else addressBook = {};

  const namesToAddresses = {};
  Object.keys(deployedContracts)
    .forEach(key => {
      namesToAddresses[key] = deployedContracts[key].address
    });
  addressBook[environment] = namesToAddresses;

  fs.writeFileSync(
    addressBookFile,
    JSON.stringify(addressBook, null, '  '),
    'utf8'
  );
}
