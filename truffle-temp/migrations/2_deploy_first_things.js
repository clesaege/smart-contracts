/* eslint-disable */
// const ourConfig = require("./ourConfig.js");
const fs = require('fs');
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
    if (network === "development") {
      const EthToken = await deployer.new(PreminedAsset);
      const MlnToken = await deployer.new(PreminedAsset);
      const EurToken = await deployer.new(PreminedAsset);
      const tokenAddresses = {
        "EthToken": EthToken.address,
        "MlnToken": MlnToken.address,
        "EurToken": EurToken.address
      };
      const governance = await deployer.deploy(Governance, [accounts[0]], 1, 100000);
      await deployer.deploy(CanonicalPriceFeed, MlnToken.address,
        EthToken.address,
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
        governance.address,
        {gas: 100000000}
      );
      await deployer.deploy(SimpleMarket);
      await deployer.deploy(SimpleAdapter);
      await deployer.deploy(MatchingMarket, 154630446100);
      await deployer.deploy(MatchingMarketAdapter);
      await deployer.deploy(NoCompliance);
      await deployer.deploy(RMMakeOrders);
      await deployer.deploy(CentralizedAdapter);
      await deployer.deploy(CompetitionCompliance, accounts[0]);
      await deployer.deploy(Version, "2", Governance.address, MlnToken.address, EthToken.address, CanonicalPriceFeed.address, CompetitionCompliance.address);
      await deployer.deploy(FundRanking);
      const stakingPriceFeedInstance = await createStakingFeed(await CanonicalPriceFeed.deployed());
      const blockchainTime = Math.floor(new Date().valueOf() / 1000);
      await deployer.deploy(Competition, MlnToken.address, EurToken.address, EthToken.address, accounts[5], blockchainTime, blockchainTime + 8640000, 20 * 10 ** 18, 10 ** 23, 10, false);

      const competitionComplianceInstance = await CompetitionCompliance.deployed();
      await competitionComplianceInstance.changeCompetitionAddress(Competition.address);
      const competitionInstance = await Competition.deployed();
      await competitionInstance.batchAddToWhitelist(10 ** 25, [accounts[0], accounts[1], accounts[2]]);

      // whitelist trading pairs
      const pairsToWhitelist = [
        [MlnToken.address, EthToken.address],
        [EurToken.address, EthToken.address],
        [MlnToken.address, EurToken.address],
      ];
      const matchingMarketInstance = await MatchingMarket.deployed();
      await Promise.all(
        pairsToWhitelist.map(async (pair) => {
          await matchingMarketInstance.addTokenPairWhitelist(pair[0], pair[1]);
        })
      );

      // add Version to Governance tracking
      const governanceInstance = await Governance.deployed();
      await governanceAction(governanceInstance, governanceInstance, 'addVersion', [Version.address]);

      // whitelist exchange
      const canonicalPriceFeedInstance = await CanonicalPriceFeed.deployed();
      /*
      await governanceAction(
        governanceInstance, canonicalPriceFeedInstance, 'registerExchange',
        [
          MatchingMarket.address,
          MatchingMarketAdapter.address,
          true,
          [
            makeOrderSignature,
            takeOrderSignature,
            cancelOrderSignature
          ]
        ]
      );
      */
      // register assets
      await governanceAction(governanceInstance, canonicalPriceFeedInstance, 'registerAsset', [
        MlnToken.address,
        "Melon token",
        "MLN-T",
        18,
        "melonport.com",
        mockBytes,
        [mockAddress, mockAddress],
        [],
        []
      ]);
      await governanceAction(governanceInstance, canonicalPriceFeedInstance, 'registerAsset', [
        EurToken.address,
        "Euro token",
        "EUR-T",
        18,
        "europa.eu",
        mockBytes,
        [mockAddress, mockAddress],
        [],
        []
      ]);

      fs.writeFileSync(tokenInfoFileName, JSON.stringify(tokenAddresses, null, '  '));
    }
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
  await governance.confirm(proposalId);
  await governance.trigger(proposalId);
}
