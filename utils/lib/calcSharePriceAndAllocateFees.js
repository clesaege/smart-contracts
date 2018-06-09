import api from "./api";

async function calcSharePriceAndAllocateFees(fund, manager, config) {
  const tx = await fund.instance.calcSharePriceAndAllocateFees.postTransaction(
    { from: manager, gasPrice: config.gasPrice },
    ["0x0000000000000000000000000000000000000000"],
  );
  const block = await api.eth.getTransactionReceipt(tx);
  const timestamp = (await api.eth.getBlockByNumber(block.blockNumber))
    .timestamp
  return timestamp;
}

export default calcSharePriceAndAllocateFees;
