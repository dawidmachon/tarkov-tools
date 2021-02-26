const fs = require('fs');
const path = require('path');

const got = require('got');

const sleep = require('./modules/sleep');
const fleaMarketFee = require('./modules/flea-market-fee');
const questData = require('./modules/quests');

const itemIds = require('../src/data/items.json');
const calculateBestPrice = require('./modules/calculate-best-price');
const normalizeName = require('./modules/normalize-name');

const CURRENCY_MODIFIER = {
    "₽": 1,
    "$": 125,
    "€": 142,
};

const availableLanguages = [
    'en',
    // 'ru',
    // 'de',
    // 'fr',
    // 'es',
    // 'cn',
];

const mappingProperties = [
    {
        propertyKey: 'BlindnessProtection',
        type: 'glasses',
    },
    {
        propertyKey: 'MaxDurability',
        type: 'armor',
    },
    {
        propertyKey: 'armorClass',
        type: 'armor',
    },
    {
        propertyKey: 'speedPenaltyPercent',
        type: 'armor',
    },
    {
        propertyKey: 'mousePenalty',
        type: 'armor',
    },
    {
        propertyKey: 'weaponErgonomicPenalty',
        type: 'armor',
    },
    {
        propertyKey: 'armorZone',
        type: 'armor',
    },
    {
        propertyKey: 'ArmorMaterial',
        type: 'armor',
    },
    {
        propertyKey: 'headSegments',
        type: 'helmet',
    },
    {
        propertyKey: 'BlocksEarpiece',
        type: 'helmet',
    },
    {
        propertyKey: 'DeafStrength',
        type: 'helmet',
    },
    {
        propertyKey: 'RicochetParams',
        type: 'helmet',
    },
];

let itemData = {};

const getBsgTypes = (itemId, bsgData) => {
    const currentType = [bsgData[itemId]._props.Name];
    if(!bsgData[itemId]._parent){
        return currentType;
    }

    return getBsgTypes(bsgData[itemId]._parent, bsgData).concat(currentType);
};

const arrayChunk = (inputArray, chunkLength) => {
    return inputArray.reduce((resultArray, item, index) => {
        const chunkIndex = Math.floor(index / chunkLength);

        if(!resultArray[chunkIndex]) {
            resultArray[chunkIndex] = []; // start a new chunk
        }

        resultArray[chunkIndex].push(item);

        return resultArray
    }, []);
};

(async () => {
    let allItemData = {};
    let bsgData = false;
    let tempData = [];

    try {
        const chunks = arrayChunk(itemIds, 500);
        for(const chunk of chunks){
            console.time(`chunk`);
            const bodyQuery = JSON.stringify({query: `{
                    ${chunk.map((itemId) => {
                        return `item${itemId}: item(id:"${itemId}"){
                            id
                            name
                            types
                            width
                            height
                        }`;
                    }).join('\n') }
                }`
            });
            const response = await got.post('https://tarkov-tools.com/graphql', {
                body: bodyQuery,
                responseType: 'json',
            });
            console.timeEnd(`chunk`);

            tempData = tempData.concat(Object.values(response.body.data));
        }

    } catch (requestError){
        console.error(requestError);

        // We wan't CI to stop here
        process.exit(1);
    }

    for(const item of tempData){
        itemData[item.id] = item;
    }

    try {
        const response = await got('https://tarkov-market.com/api/v1/bsg/items/all', {
            headers: {
                'x-api-key': process.env.TARKOV_MARKET_API_KEY,
            },
            responseType: 'json',
        });

        bsgData = response.body;
    } catch (requestError){
        console.error(requestError);

        // We wan't CI to stop here
        process.exit(1);
    }

    for(const languageCode of availableLanguages){
        try {
            const response = await got(`https://tarkov-market.com/api/v1/items/all?lang=${languageCode}`, {
                headers: {
                    'x-api-key': process.env.TARKOV_MARKET_API_KEY,
                },
                responseType: 'json',
            });

            allItemData[languageCode] = response.body;
        } catch (requestError){
            console.error(requestError);

            // We wan't CI to stop here
            process.exit(1);
        }
        console.log(`Loading all items for ${languageCode}`);
        console.time(`all-${languageCode}`);

        console.timeEnd(`all-${languageCode}`);

        for(let i = 0; i < allItemData[languageCode].length; i = i + 1){
            const bsgItemData = bsgData[allItemData[languageCode][i].bsgId];

            allItemData[languageCode][i] = {
                types: [],
                fee: fleaMarketFee(allItemData[languageCode][i]),
                ...allItemData[languageCode][i],
                ...itemData[allItemData[languageCode][i].bsgId],
                price: allItemData[languageCode][i].avg24hPrice,
                traderPrice: allItemData[languageCode][i].traderPrice * CURRENCY_MODIFIER[allItemData[languageCode][i].traderPriceCur],
                id: allItemData[languageCode][i].bsgId,
                itemProperties: {},
                bsgTypes: [
                    ...getBsgTypes(bsgItemData._parent, bsgData).filter(Boolean),
                ],
                hasGrid: bsgItemData._props.Grids?.length > 0,
                ...calculateBestPrice(allItemData[languageCode][i]),
                linkedItems: bsgItemData._props.Slots?.map((slot) => {
                    return slot._props.filters[0].Filter;
                    // "Slots": [
                    // {
                    //     "_name": "mod_equipment_000",
                    //     "_id": "5e00c1ad86f774747333222e",
                    //     "_parent": "5e00c1ad86f774747333222c",
                    //     "_props": {
                    //         "filters": [
                    //             {
                    //                 "Shift": 0,
                    //                 "Filter": [
                    //                     "5e00cfa786f77469dc6e5685",
                    //                     "5e01f31d86f77465cf261343"
                    //                 ]
                    //             }
                    //         ]
                    //     },
                    //     "_required": false,
                    //     "_mergeSlotWithChildren": false,
                    //     "_proto": "55d30c4c4bdc2db4468b457e"
                    // },
                }).flat() || [],
                urlName: normalizeName(allItemData[languageCode][i].name),
            };

            for(const extraProp of mappingProperties){
                // if(!allItemData[languageCode][i].types.includes(extraProp.type)){
                //     continue;
                // }

                if(!bsgItemData._props[extraProp.propertyKey]){
                    continue;
                }

                allItemData[languageCode][i].itemProperties[extraProp.propertyKey] = bsgItemData._props[extraProp.propertyKey];
            }

            Reflect.deleteProperty(allItemData[languageCode][i], 'bsgId');
            Reflect.deleteProperty(allItemData[languageCode][i], 'uid');
            Reflect.deleteProperty(allItemData[languageCode][i], 'reference');
            Reflect.deleteProperty(allItemData[languageCode][i], 'isFunctional');
            Reflect.deleteProperty(allItemData[languageCode][i], 'link');
        }

        fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', `all-${languageCode}.json`), JSON.stringify(allItemData[languageCode], null, 4));

        // const ratScannerData = allItemData[languageCode].map((rawItemData) => {
        //     return {
        //         uid: rawItemData.id,
        //         name: rawItemData.name,
        //         shortName: rawItemData.shortName,
        //         slots: rawItemData.slots,
        //         wikiLink: rawItemData.wikiLink,
        //         imgLink: rawItemData.img,
        //         timestamp: Math.floor(new Date(rawItemData.updated).getTime() / 1000),
        //         price: rawItemData.price,
        //         avg24hPrice: rawItemData.avg24hPrice,
        //         avg7dPrice: rawItemData.avg7daysPrice,
        //         avg24hAgo: rawItemData.avg24hPrice + Math.floor(rawItemData.avg24hPrice * (rawItemData.diff24h / 100)),
        //         avg7dAgo: rawItemData.avg7daysPrice + Math.floor(rawItemData.avg7daysPrice * (rawItemData.diff7days / 100)),
        //         traderName: rawItemData.traderName,
        //         traderPrice: rawItemData.traderPrice,
        //         traderCurrency: rawItemData.traderPriceCur,
        //         quests: questData.getItemUsage(rawItemData.bsgId),
        //     };
        // });

        // fs.writeFileSync(path.join(__dirname, '..', 'public', 'data', `all-${languageCode}.json`), JSON.stringify(ratScannerData, null, 4));

        if(availableLanguages.length > 3){
            await sleep(30000);
        }
    }
})();
