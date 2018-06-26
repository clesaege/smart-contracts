import test from "ava";
import retrieveContract from "../utils/getContract";

const web3 = require("web3");

// hoisted variables

let riskMgmt;
let mockAddress;
let riskLevel;
let referencePrice;

test.before(async t => {
  riskMgmt = retrieveContract("RMMakeOrders", "0x58459b64f1ed71b65f886864d5f972844e8fccc4");
  mockAddress = "0x8888888721e49496726d4bf1c32876c0b41cd01f";
  riskLevel = await riskMgmt.RISK_LEVEL.call();
  referencePrice = 100;
});

test("Make order should be permitted for a high orderPrice w.r.t referencePrice", async t => {
  const orderPrice = referencePrice * 2;
  const isMakePermitted = await riskMgmt.isMakePermitted.call(
    orderPrice,
    referencePrice,
    mockAddress,
    mockAddress,
    100,
    100,
  );
  const isTakePermitted = await riskMgmt.isTakePermitted.call(
    orderPrice,
    referencePrice,
    mockAddress,
    mockAddress,
    100,
    100,
  );

  t.true(isMakePermitted);
  t.true(isTakePermitted);
});

test("Make order should be permitted for the cutoff orderPrice w.r.t referencePrice", async t => {
  const orderPrice =
    referencePrice - referencePrice * riskLevel.div(10 ** 18).toNumber();
  const isMakePermitted = await riskMgmt.isMakePermitted.call(
    orderPrice,
    referencePrice,
    mockAddress,
    mockAddress,
    100,
    100,
  );
  const isTakePermitted = await riskMgmt.isTakePermitted.call(
    orderPrice,
    referencePrice,
    mockAddress,
    mockAddress,
    100,
    100,
  );

  t.true(isMakePermitted);
  t.true(isTakePermitted);
});

test("Make and take orders should not be permitted for a low orderPrice w.r.t referencePrice", async t => {
  const orderPrice = Math.floor(
    referencePrice - (referencePrice * riskLevel.div(10 ** 18).toNumber() + 0.1)
  );
  const isMakePermitted = await riskMgmt.isMakePermitted.call(
    orderPrice,
    referencePrice,
    mockAddress,
    mockAddress,
    100,
    100,
  );
  const isTakePermitted = await riskMgmt.isTakePermitted.call(
    orderPrice,
    referencePrice,
    mockAddress,
    mockAddress,
    100,
    100,
  );

  t.false(isMakePermitted);
  t.false(isTakePermitted);
});
