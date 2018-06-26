import * as fs from 'fs';

const Web3 = require("web3")
const contract = require("truffle-contract");
const provider = new Web3.providers.HttpProvider("http://localhost:8545");

function retrieveContract(contractName, address) {
  const MyContract = contract({
    abi: JSON.parse(fs.readFileSync(`./build/contracts/${contractName}.json`, 'utf8')).abi,
  });
  MyContract.setProvider(provider);
  return MyContract.at(address);
}

export default retrieveContract;
