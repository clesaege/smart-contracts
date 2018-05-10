pragma solidity ^0.4.19;

import "./CanonicalRegistrar.sol";
import "./StakingPriceFeed.sol";
import "./SimplePriceFeed.sol";
import "./SimplePriceFeedInterface.sol";
import "../system/OperatorStaking.sol";

/// @title Price Feed Template
/// @author Melonport AG <team@melonport.com>
/// @notice Routes external data to smart contracts
/// @notice Where external data includes sharePrice of Melon funds
/// @notice PriceFeed operator could be staked and sharePrice input validated on chain
contract CanonicalPriceFeed is OperatorStaking, CanonicalRegistrar {

    // EVENTS
    event SetupPriceFeed(address ofPriceFeed);
    event PriceUpdated(bytes32 hash);

    // TYPES
    struct UpdateData {
        address[] assets;
        uint[] prices;
        uint timestamp;
    }

    struct AssetData {
        uint price;
        uint timestamp;
    }

    // FIELDS
    bool public updatesAreAllowed = true;
    uint public minimumPriceCount = 1;
    uint public VALIDITY;
    uint public INTERVAL;
    uint public INCEPTION;
    uint public PRE_EPOCH_UPDATE_PERIOD;
    uint public MINIMUM_UPDATES_PER_EPOCH;
    uint public POST_EPOCH_INTERVENTION_PERIOD;
    uint public lastUpdateTime;
    uint public updateId;        // Update counter for this pricefeed; used as a check during investment
    address public QUOTE_ASSET; // Asset of a portfolio against which all other assets are priced
    address[] public operatorsUpdatingThisEpoch;
    UpdateData[] public historicalPrices;
    mapping (address => AssetData) public backupPrices; // these prices are valid until end of next intervention delay
    mapping (address => AssetData) public latestPrices; // these prices are valid after intervention delay is over
    mapping (address => bool) public isStakingFeed; // If the Staking Feed has been created through this contract

    // METHODS

    // CONSTRUCTOR

    /// @dev Define and register a quote asset against which all prices are measured/based against
    /// @param ofStakingAsset Address of staking asset (may or may not be quoteAsset)
    /// @param ofQuoteAsset Address of quote asset
    /// @param quoteAssetName Name of quote asset
    /// @param quoteAssetSymbol Symbol for quote asset
    /// @param quoteAssetDecimals Decimal places for quote asset
    /// @param quoteAssetUrl URL related to quote asset
    /// @param quoteAssetIpfsHash IPFS hash associated with quote asset
    /// @param quoteAssetBreakInBreakOut Break-in/break-out for quote asset on destination chain
    /// @param quoteAssetStandards EIP standards quote asset adheres to
    /// @param quoteAssetFunctionSignatures Whitelisted functions of quote asset contract
    // /// @param interval Number of seconds between pricefeed updates (this interval is not enforced on-chain, but should be followed by the datafeed maintainer)
    // /// @param validity Number of seconds that datafeed update information is valid for
    /// @param ofGovernance Address of contract governing the Canonical PriceFeed
    function CanonicalPriceFeed(
        address ofStakingAsset,
        address ofQuoteAsset, // Inital entry in asset registrar contract is Melon (QUOTE_ASSET)
        bytes32 quoteAssetName,
        bytes8 quoteAssetSymbol,
        uint quoteAssetDecimals,
        string quoteAssetUrl,
        string quoteAssetIpfsHash,
        address[2] quoteAssetBreakInBreakOut,
        uint[] quoteAssetStandards,
        bytes4[] quoteAssetFunctionSignatures,
        uint[5] updateInfo, // interval, validity, preEpochUpdatePeriod, minimumUpdatesPerEpoch, interventionPeriod
        uint[2] stakingInfo, // minStake, numOperators
        address ofGovernance
    )
        OperatorStaking(AssetInterface(ofStakingAsset), stakingInfo[0], stakingInfo[1])
    {
        QUOTE_ASSET = ofQuoteAsset;
        registerAsset(
            ofQuoteAsset,
            quoteAssetName,
            quoteAssetSymbol,
            quoteAssetDecimals,
            quoteAssetUrl,
            quoteAssetIpfsHash,
            quoteAssetBreakInBreakOut,
            quoteAssetStandards,
            quoteAssetFunctionSignatures
        );
        INTERVAL = updateInfo[0];
        VALIDITY = updateInfo[1];
        INCEPTION = block.timestamp;
        PRE_EPOCH_UPDATE_PERIOD = updateInfo[2];
        MINIMUM_UPDATES_PER_EPOCH = updateInfo[3];
        POST_EPOCH_INTERVENTION_PERIOD = updateInfo[4];
        setOwner(ofGovernance);
    }

    // EXTERNAL METHODS

    /// @notice Create a new StakingPriceFeed
    function setupStakingPriceFeed() external {
        address ofStakingPriceFeed = new StakingPriceFeed(
            address(this),
            stakingToken,
            address(this)
        );
        isStakingFeed[ofStakingPriceFeed] = true;
        StakingPriceFeed(ofStakingPriceFeed).setOwner(msg.sender);
        emit SetupPriceFeed(ofStakingPriceFeed);
    }

    /// @dev overriden from interface
    function update() external { revert(); }

    /// @dev Burn state for a pricefeed operator
    /// @param user Address of pricefeed operator to burn the stake from
    /// @param amount Amount of stake to burn
    /// @param data Additional data
    function burnStake(address user, uint amount, bytes data)
        external
        auth
    {
        require(totalStakedFor(user) >= amount);
        uint preStake = totalStakedFor(user);
        uint postStake = sub(preStake, amount);
        require(postStake >= minimumStake || postStake == 0);
        updateCheckpointAtNow(stakesFor[user], amount, true);
        updateCheckpointAtNow(stakeHistory, amount, true);
        updateStakerRanking(user);
        StakeBurned(user, amount, data);
    }

    // PUBLIC METHODS

    // STAKING

    function stake(
        uint amount,
        bytes data
    )
        public
        pre_cond(isStakingFeed[msg.sender])
    {
        OperatorStaking.stake(amount, data);
    }
  
    function stakeFor(
        address user,
        uint amount,
        bytes data
    )
        public
        pre_cond(isStakingFeed[user])
    {

        OperatorStaking.stakeFor(user, amount, data);
    }

    // UPDATING

    /// @dev Used for testing (INTERVAL == 0)
    function forceCollectAndUpdate()
        public
        auth
        pre_cond(INTERVAL == 0)
    {
        collectAndUpdate(getRegisteredAssets());
        delete operatorsUpdatingThisEpoch;
        require(operatorsUpdatingThisEpoch.length == 0);
    }

    function _updatePrices(address[] ofAssets, uint[] newPrices)
        internal
        pre_cond(ofAssets.length == newPrices.length)
    {
        updateId++;
        for (uint i = 0; i < ofAssets.length; ++i) {
            require(assetIsRegistered(ofAssets[i]));
            latestPrices[ofAssets[i]].timestamp = now;
            latestPrices[ofAssets[i]].price = newPrices[i];
        }
        emit PriceUpdated(keccak256(ofAssets, newPrices));
    }

    // TODO: convert requires to pre_cond when number of variables is finalized
    function subFeedPostUpdateHook() public {
        address[] memory registeredAssets;
        require(isOperator(msg.sender));
        if (INTERVAL != 0) {
            require(isNowUpdatePeriod());
            require(updatesAreAllowed);
            if (lastUpdateTime < getLastEpochTime()) { // new epoch
                delete operatorsUpdatingThisEpoch;     // clear list
                require(operatorsUpdatingThisEpoch.length == 0);
                registeredAssets = getRegisteredAssets();
                for (uint i = 0; i < registeredAssets.length; i++) { // shift to secondary mapping
                    backupPrices[registeredAssets[i]] = latestPrices[registeredAssets[i]];
                    delete latestPrices[registeredAssets[i]];
                }
            }
            require(!hasUpdatedThisEpoch(msg.sender));
            lastUpdateTime = block.timestamp;
        }

        operatorsUpdatingThisEpoch.push(msg.sender);

        if (INTERVAL != 0 && operatorsUpdatingThisEpoch.length >= MINIMUM_UPDATES_PER_EPOCH) {
            registeredAssets = getRegisteredAssets();
            collectAndUpdate(registeredAssets);
        }
    }

    // AGGREGATION

    /// @dev Only Owner; Same sized input arrays
    /// @dev Updates price of asset relative to QUOTE_ASSET
    /** Ex:
     *  Let QUOTE_ASSET == MLN (base units), let asset == EUR-T,
     *  let Value of 1 EUR-T := 1 EUR == 0.080456789 MLN, hence price 0.080456789 MLN / EUR-T
     *  and let EUR-T decimals == 8.
     *  Input would be: information[EUR-T].price = 8045678 [MLN/ (EUR-T * 10**8)]
     */
    /// @param ofAssets list of asset addresses
    function collectAndUpdate(address[] ofAssets)
        internal
    {
        address[] memory operators = operatorsUpdatingThisEpoch;
        uint[] memory newPrices = new uint[](ofAssets.length);
        for (uint i = 0; i < ofAssets.length; i++) {
            uint[] memory assetPrices = new uint[](operators.length);
            for (uint j = 0; j < operators.length; j++) {
                SimplePriceFeed feed = SimplePriceFeed(operators[j]);
                var (price, timestamp) = feed.assetsToPrices(ofAssets[i]);
                if (now > add(timestamp, VALIDITY)) {
                    continue; // leaves a zero in the array (dealt with later)
                }
                assetPrices[j] = price;
            }
            newPrices[i] = medianize(assetPrices);
        }
        _updatePrices(ofAssets, newPrices);
        historicalPrices.push(
            UpdateData({
                assets: ofAssets,
                prices: newPrices,
                timestamp: block.timestamp
            })
        );
    }

    /// @dev from MakerDao medianizer contract
    function medianize(uint[] unsorted)
        view
        returns (uint)
    {
        uint numValidEntries;
        for (uint i = 0; i < unsorted.length; i++) {
            if (unsorted[i] != 0) {
                numValidEntries++;
            }
        }
        if (numValidEntries < minimumPriceCount) {
            revert();
        }
        uint counter;
        uint[] memory out = new uint[](numValidEntries);
        for (uint j = 0; j < unsorted.length; j++) {
            uint item = unsorted[j];
            if (item != 0) {    // skip zero (invalid) entries
                if (counter == 0 || item >= out[counter - 1]) {
                    out[counter] = item;  // item is larger than last in array (we are home)
                } else {
                    uint k = 0;
                    while (item >= out[k]) {
                        k++;  // get to where element belongs (between smaller and larger items)
                    }
                    for (uint l = counter; l > k; l--) {
                        out[l] = out[l - 1];    // bump larger elements rightward to leave slot
                    }
                    out[k] = item;
                }
                counter++;
            }
        }

        uint value;
        if (counter % 2 == 0) {
            uint value1 = uint(out[(counter / 2) - 1]);
            uint value2 = uint(out[(counter / 2)]);
            value = add(value1, value2) / 2;
        } else {
            value = out[(counter - 1) / 2];
        }
        return value;
    }

    function setMinimumPriceCount(uint newCount) auth { minimumPriceCount = newCount; }
    function resumeUpdating() auth { updatesAreAllowed = true; }
    function interruptUpdating()
        auth
        pre_cond(isNowInterventionPeriod())
    {
        updatesAreAllowed = false;
    }

    // PUBLIC VIEW METHODS

    // FEED INFORMATION

    function getQuoteAsset() view returns (address) { return QUOTE_ASSET; }
    function getInterval() view returns (uint) { return INTERVAL; }
    function getValidity() view returns (uint) { return VALIDITY; }
    function getLastUpdateId() view returns (uint) { return updateId; }

    // PRICES

    /// @notice Whether price of asset has been updated less than VALIDITY seconds ago
    /// @param ofAsset Asset in registrar
    /// @return isRecent Price information ofAsset is recent
    function hasRecentPrice(address ofAsset)
        view
        pre_cond(assetIsRegistered(ofAsset))
        returns (bool isRecent)
    {
        var ( , timestamp) = getPrice(ofAsset);
        return (sub(now, timestamp) <= VALIDITY);
    }

    /// @notice Whether prices of assets have been updated less than VALIDITY seconds ago
    /// @param ofAssets All assets in registrar
    /// @return isRecent Price information ofAssets array is recent
    function hasRecentPrices(address[] ofAssets)
        view
        returns (bool areRecent)
    {
        for (uint i; i < ofAssets.length; i++) {
            if (!hasRecentPrice(ofAssets[i])) {
                return false;
            }
        }
        return true;
    }

    /**
    @notice Gets price of an asset multiplied by ten to the power of assetDecimals
    @dev Asset has been registered
    @param ofAsset Asset for which price should be returned
    @return {
      "price": "Price formatting: mul(exchangePrice, 10 ** decimal), to avoid floating numbers",
      "timestamp": "When the asset's price was updated"
    }
    */
    function getPrice(address ofAsset)
        view
        returns (uint price, uint timestamp)
    {
        AssetData memory data;
        if (INTERVAL == 0) { // special case for testing only; just return latest prices
            data = latestPrices[ofAsset];
        } else if (isNowUpdatePeriod()) {
            if (lastUpdateTime < getLastEpochTime()) {
                // 1st update for next epoch has not occurred, so secondary mapping not yet updated
                data = latestPrices[ofAsset];
            } else {
                // secondary mapping was updated, so can use it
                data = backupPrices[ofAsset];
            }
        } else if (isNowInterventionPeriod()) {
            data = backupPrices[ofAsset];
        } else if (
            !isNowUpdatePeriod() &&
            !isNowInterventionPeriod()
        ) {
            if (updatesAreAllowed) {    // intervention is not occurring
                data = latestPrices[ofAsset];
            } else { // intervention is occurring
                data = backupPrices[ofAsset];
            }
        }
        return (data.price, data.timestamp);
    }

    /**
    @notice Price of a registered asset in format (bool areRecent, uint[] prices, uint[] decimals)
    @dev Convention for price formatting: mul(price, 10 ** decimal), to avoid floating numbers
    @param ofAssets Assets for which prices should be returned
    @return {
        "prices":       "Array of prices",
        "timestamps":   "Array of timestamps",
    }
    */
    function getPrices(address[] ofAssets)
        view
        returns (uint[], uint[])
    {
        uint[] memory prices = new uint[](ofAssets.length);
        uint[] memory timestamps = new uint[](ofAssets.length);
        for (uint i; i < ofAssets.length; i++) {
            var (price, timestamp) = getPrice(ofAssets[i]);
            prices[i] = price;
            timestamps[i] = timestamp;
        }
        return (prices, timestamps);
    }

    function getPriceInfo(address ofAsset)
        view
        returns (bool isRecent, uint price, uint assetDecimals)
    {
        isRecent = hasRecentPrice(ofAsset);
        (price, ) = getPrice(ofAsset);
        assetDecimals = getDecimals(ofAsset);
    }

    /**
    @notice Gets inverted price of an asset
    @dev Asset has been initialised and its price is non-zero
    @dev Existing price ofAssets quoted in QUOTE_ASSET (convention)
    @param ofAsset Asset for which inverted price should be return
    @return {
        "isRecent": "Whether the price is fresh, given VALIDITY interval",
        "invertedPrice": "Price based (instead of quoted) against QUOTE_ASSET",
        "assetDecimals": "Decimal places for this asset"
    }
    */
    function getInvertedPriceInfo(address ofAsset)
        view
        returns (bool isRecent, uint invertedPrice, uint assetDecimals)
    {
        uint inputPrice;
        // inputPrice quoted in QUOTE_ASSET and multiplied by 10 ** assetDecimal
        (isRecent, inputPrice, assetDecimals) = getPriceInfo(ofAsset);

        // outputPrice based in QUOTE_ASSET and multiplied by 10 ** quoteDecimal
        uint quoteDecimals = getDecimals(QUOTE_ASSET);

        return (
            isRecent,
            mul(10 ** uint(quoteDecimals), 10 ** uint(assetDecimals)) / inputPrice,
            quoteDecimals   // TODO: check on this; shouldn't it be assetDecimals?
        );
    }

    /**
    @notice Gets reference price of an asset pair
    @dev One of the address is equal to quote asset
    @dev either ofBase == QUOTE_ASSET or ofQuote == QUOTE_ASSET
    @param ofBase Address of base asset
    @param ofQuote Address of quote asset
    @return {
        "isRecent": "Whether the price is fresh, given VALIDITY interval",
        "referencePrice": "Reference price",
        "decimal": "Decimal places for this asset"
    }
    */
    function getReferencePriceInfo(address ofBase, address ofQuote)
        view
        returns (bool isRecent, uint referencePrice, uint decimal)
    {
        if (getQuoteAsset() == ofQuote) {
            (isRecent, referencePrice, decimal) = getPriceInfo(ofBase);
        } else if (getQuoteAsset() == ofBase) {
            (isRecent, referencePrice, decimal) = getInvertedPriceInfo(ofQuote);
        } else {
            revert(); // no suitable reference price available
        }
    }

    /// @notice Gets price of Order
    /// @param sellAsset Address of the asset to be sold
    /// @param buyAsset Address of the asset to be bought
    /// @param sellQuantity Quantity in base units being sold of sellAsset
    /// @param buyQuantity Quantity in base units being bought of buyAsset
    /// @return orderPrice Price as determined by an order
    function getOrderPriceInfo(
        address sellAsset,
        address buyAsset,
        uint sellQuantity,
        uint buyQuantity
    )
        view
        returns (uint orderPrice)
    {
        return mul(buyQuantity, 10 ** uint(getDecimals(sellAsset))) / sellQuantity;
    }

    /// @notice Checks whether data exists for a given asset pair
    /// @dev Prices are only upated against QUOTE_ASSET
    /// @param sellAsset Asset for which check to be done if data exists
    /// @param buyAsset Asset for which check to be done if data exists
    /// @return Whether assets exist for given asset pair
    function existsPriceOnAssetPair(address sellAsset, address buyAsset)
        view
        returns (bool isExistent)
    {
        return
            hasRecentPrice(sellAsset) && // Is tradable asset (TODO cleaner) and datafeed delivering data
            hasRecentPrice(buyAsset) && // Is tradable asset (TODO cleaner) and datafeed delivering data
            (buyAsset == QUOTE_ASSET || sellAsset == QUOTE_ASSET) && // One asset must be QUOTE_ASSET
            (buyAsset != QUOTE_ASSET || sellAsset != QUOTE_ASSET); // Pair must consists of diffrent assets
    }

    /// @return Sparse array of addresses of owned pricefeeds
    function getPriceFeedsByOwner(address _owner)
        view
        returns(address[])
    {
        address[] memory ofPriceFeeds = new address[](stakeRanking.length);
        for (uint i; i < stakeRanking.length; i++) {
            StakingPriceFeed stakingFeed = StakingPriceFeed(stakeRanking[i].staker);
            if (stakingFeed.owner() == _owner) {
                ofPriceFeeds[i] = address(stakingFeed);
            }
        }
        return ofPriceFeeds;
    }

    // UPDATE TRACKING
 
    /// @return Timestamp for the last epoch, regardless of whether an update occurred for it
    function getLastEpochTime() view returns (uint) { // TODO: special case for zero INTERVAL?
        uint timeSinceLastEpoch = sub(block.timestamp, INCEPTION) % INTERVAL;
        return sub(block.timestamp, timeSinceLastEpoch);
    }

    function getNextEpochTime() view returns (uint) { // TODO: special case for zero INVERVAL?
        uint lastEpochTime = getLastEpochTime();
        return add(lastEpochTime, INTERVAL);
    }

    function isNowInterventionPeriod() view returns (bool) {
        return (
            block.timestamp >= getLastEpochTime() &&
            block.timestamp <= add(getLastEpochTime(), POST_EPOCH_INTERVENTION_PERIOD)
        );
    }

    function isNowUpdatePeriod() view returns (bool) {
        return (
            block.timestamp < getNextEpochTime() &&
            block.timestamp >= sub(getNextEpochTime(), PRE_EPOCH_UPDATE_PERIOD)
        );
    }
 
    // TODO: may not be necessary in the end. Remove if commented out during cleanup.
    // /// @return Whether a new epoch has occurred since the last full canonical update
    // function isNewEpoch() view returns (bool) { // TODO: special case for zero INTERVAL?
    //     return lastUpdateTime < getLastEpochTime();
    // }

    function hasUpdatedThisEpoch(address ofOperator) view returns (bool) {
        for (uint i = 0; i < operatorsUpdatingThisEpoch.length; i++) {
            if (operatorsUpdatingThisEpoch[i] == ofOperator) {
                return true;
            }
        }
        return false; // default
    }
}
