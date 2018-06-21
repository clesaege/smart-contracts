// const ourConfig = require("./ourConfig.js");
const fs = require('fs');
import * as masterConfig from "../../utils/config/environment";

const PreminedAsset = artifacts.require("./PreminedAsset.sol");
const Governance = artifacts.require("./Governance.sol");

const tokenInfoFileName = "./tokenInfo.config";

module.exports = function(deployer, network, accounts) {
  deployer.then(async () => {
    const config = masterConfig[network];
    if (network === "development") {
      const ethToken = await deployer.new(PreminedAsset);
      const mlnToken = await deployer.new(PreminedAsset);
      const eurToken = await deployer.new(PreminedAsset);
      const tokenAddresses = {
        "EthToken": ethToken.address,
        "MlnToken": mlnToken.address,
        "EurToken": eurToken.address
      };
      fs.writeFileSync(tokenInfoFileName, JSON.stringify(tokenAddresses, null, '  '));
      await deployer.deploy(Governance, [accounts[0]], 1, 100000);
    }
  });
};
