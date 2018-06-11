import api from "./api";

async function calcSharePrice(fund, manager, config) {
  const tx = await fund.instance.calcSharePrice.postTransaction(
    { from: manager, gasPrice: config.gasPrice },
    [],
  );
  const block = await api.eth.getTransactionReceipt(tx);
  const timestamp = (await api.eth.getBlockByNumber(block.blockNumber))
    .timestamp
  return timestamp;
}

export default calcSharePrice;
