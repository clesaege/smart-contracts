var EthToken = artifacts.require("./PreminedAsset.sol");

module.exports = function(deployer) {
  deployer.deploy(EthToken);
};
