#!/usr/bin/node

let Table = require("./terminal-table");
let commandLineArgs = require("command-line-args");
let terminal = require('./terminal');
let termkit = require( 'terminal-kit' ) ;
let term = termkit.terminal ;
let config = require('./config-reader.js');

const commandLineOptionDefinitions = [
    { name: 'quote', alias: 'q', type: String, typeLabel: '[underline]{QUOTE}', description: 'This defines quote for markets (we trade in this currency)' },
    { name: 'balance', alias: 'b', type: Boolean, description: 'Go to balance overview' },
    { name: 'currency', alias: 'c', type: String, typeLabel: '[underline]{CURRENCY}', description: 'Currency for coin market cap (USD, EUR, CNY,...). Defult is USD' },
    { name: 'crossstock', type: Boolean, description: 'Go to cross-stock analysis' },
    { name: 'crosscurrency', type: Boolean, description: 'Go to cross-currency analysis' },
    { name: 'btcusd', type: Boolean, description: 'Show BTC / USD price' },
    { name: 'exchange', alias: 'e', type: String, defaultOption: true , typeLabel: '[underline]{COIN}', description: 'Load stock details about given coin' },
    { name: 'password', alias: 'p', type: String, typeLabel: '[underline]{PASSWORD}', description: 'Pre-fill config password in command line' }
];

let cmo = null;

try {
    cmo = commandLineArgs(commandLineOptionDefinitions);
}catch(e){

    terminal.writeLine('Unknown usage.');

    const getUsage = require('command-line-usage');

    const sections = [
        {
            header: 'Trading CP',
            content: 'Allows trading of [italic]{various cryptocurrencies} on multiple stocks.'
        },
        {
            header: 'Options',
            optionList: commandLineOptionDefinitions
        }
    ];

    const usage = getUsage(sections);
    terminal.writeLine(usage);

    process.exit();
}

const command_line_options = cmo;


// -----------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------
// ---------------------------------------- SHARED VARIABLES -------------------------------------------
// -----------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------

let _SELECTED_QUOTE = 'BTC';
let _SELECTED_CURRENCY = 'USD';
let _BALANCES_BY_COINS = {};
let _BALANCES_BY_EXCHANGES = {};
let _PRICES_BY_EXCHANGES = {};
let _PRICES_BY_COINS = {};
let _QUOTES_BY_EXCHANGES = {};
let _EXCHANGES_BY_QUOTES = {};
let _OPEN_ORDERS = {};

let _COINMARKETCAP_COINS = {};

function getArrayItem(){

    if(arguments.length < 2)
        return undefined;

    let tempVariable = arguments[0];

    for(let i = 1; i < arguments.length; i++){

        if (!tempVariable[arguments[i]] || (i < (arguments.length - 1) && ((tempVariable[arguments[i]]).constructor !== Array && (tempVariable[arguments[i]]).constructor !== Object))) {
            return null;
        }

        tempVariable = tempVariable[arguments[i]];
    }

    return tempVariable;
}

let _EXCHANGES_API_LAST_CALLED = {};

function APICallTimeLog(exchange_id){
    _EXCHANGES_API_LAST_CALLED[exchange_id] = Date.now();
}

async function APISleep(exchange_id){

    let sleep = (ms) => new Promise (resolve => setTimeout (resolve, ms));

    let wait_time = APICallWait(exchange_id);

    if(wait_time)
        await sleep(wait_time);

    APICallTimeLog(exchange_id);

}

function APICallWait(exchange_id){
    if(!_EXCHANGES_API_LAST_CALLED[exchange_id])
        return 0;

    let last_called_time = parseInt(_EXCHANGES_API_LAST_CALLED[exchange_id]);

    let wait = last_called_time + config.exchanges[exchange_id].rateLimit - Date.now();

    if(wait < 0)
        return 0;

    return wait;
}
// -----------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------
// ---------------------------------------- HELPER FUNCTIONS -------------------------------------------
// -----------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------


function getYmdHisDate(timestamp){


    var date = new Date(Date.now());

    if(timestamp)
        date = new Date(timestamp);

    var year = date.getFullYear();
    var month = date.getMonth() + 1;
    var day = date.getDate();
    var hours = date.getHours();
    var minutes = date.getMinutes();
    var seconds = date.getSeconds();

    return(year + "-" + (month < 10 ? '0' : '') + month + "-" + (day < 10 ? '0' : '') + day + " " + (hours < 10 ? '0' : '') + hours + ":"  + (minutes < 10 ? '0' : '') + minutes + ":" + (seconds < 10 ? '0' : '') + seconds);
}

let progressBar = null;

function terminate()
{
    setTimeout( function() { term.down(1000); term.processExit() } , 100 ) ;
}

function coinSymbolChar(coin){

    coin = coin.toUpperCase();

    switch(coin){
        case 'BTC':
            return '฿';
        case 'ETH':
            return 'Ξ';
        case 'USD':
            return '$';
    }

    return coin;
}

async function getPricesAndBalances(reload){

    // balances + prices + coinmarketcap
    createProgressBar(160, 'Fetching Details', Object.keys(config.exchanges).length * 2 + 1);

    let promise_prices = getPrices(reload, true);
    let promise_balances = getBalances(reload, true);
    let promise_coinmarketcap = getCoinMarketCapData(reload, true);

    await promise_prices;
    await promise_balances;
    await promise_coinmarketcap;

    progressBar.update(1);
    progressBar.stop();

}

async function getCoinMarketCapData(reload, do_not_create_progress_bar){

    if(
        !(Object.keys(_COINMARKETCAP_COINS).length === 0 && _COINMARKETCAP_COINS.constructor === Object) &&
        !(Object.keys(_COINMARKETCAP_COINS[_SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE]).length === 0 && _COINMARKETCAP_COINS[_SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE].constructor === Object) &&
        !reload
    ) {
        return false;
    }

    if(!do_not_create_progress_bar)
        createProgressBar(160, 'Fetching Coinmarketcap', 1);

    _COINMARKETCAP_COINS[_SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE] = {};

    try{

        progressBar.startItem( 'coinmarketcap' ) ;

        let coinmarketcap_tickers = await config.coinmarketcap.fetchTickers(_SELECTED_CURRENCY);

        progressBar.itemDone( 'coinmarketcap' );


        if(Object.keys(coinmarketcap_tickers).length > 0){

            let quote_currency_price = parseFloat(coinmarketcap_tickers[_SELECTED_QUOTE+'/'+_SELECTED_CURRENCY]['last']);

            for(let symbol in coinmarketcap_tickers){
                if(!coinmarketcap_tickers.hasOwnProperty(symbol))
                    continue;

                let s = coinmarketcap_tickers[symbol]['symbol'].match(/(.*)\/USD$/i);
                let coin = s[1];

                let market_cap_currency = parseFloat(coinmarketcap_tickers[symbol]['info']['market_cap_usd']);

                if(!market_cap_currency)
                    continue;

                let market_cap_quote = market_cap_currency / quote_currency_price;

                let last_coin_price_currency = parseFloat(coinmarketcap_tickers[symbol]['last']);
                let last_coin_price_quote = last_coin_price_currency / quote_currency_price;

                _COINMARKETCAP_COINS[_SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE][coin] = {
                    id: coinmarketcap_tickers[symbol]['info']['id'],
                    name: coinmarketcap_tickers[symbol]['info']['name'],
                    rank: coinmarketcap_tickers[symbol]['info']['rank'],
                    market_cap: market_cap_quote,
                    market_cap_currency: coinmarketcap_tickers[symbol]['info']['market_cap_usd'],
                    price: last_coin_price_quote,
                    price_currency: last_coin_price_currency,
                    available_supply: parseFloat(coinmarketcap_tickers[symbol]['info']['available_supply']),
                    total_supply: parseFloat(coinmarketcap_tickers[symbol]['info']['total_supply']),
                    max_supply: parseFloat(coinmarketcap_tickers[symbol]['info']['max_supply']),
                    percent_change_1h: parseFloat(coinmarketcap_tickers[symbol]['info']['percent_change_1h']),
                    percent_change_24h: parseFloat(coinmarketcap_tickers[symbol]['info']['percent_change_24h']),
                    percent_change_7d: parseFloat(coinmarketcap_tickers[symbol]['info']['percent_change_7d']),
                    quoteVolume: parseFloat(coinmarketcap_tickers[symbol]['quoteVolume']),
                };
            }
        }
    }catch (e){
        console.log('exception', e);
    }

    if(!do_not_create_progress_bar)
        progressBar.stop();
}

function createProgressBar(width, title, items){

    terminal.nl();

    progressBar = term.progressBar( {
        width: width ,
        title: title ,
        eta: true ,
        percent: true,
        items: items
    } ) ;

}

async function getPrices(reload, do_not_create_progress_bar){

    if(
        (
            !(Object.keys(_PRICES_BY_EXCHANGES).length === 0 && _PRICES_BY_EXCHANGES.constructor === Object) &&
            !(Object.keys(_PRICES_BY_EXCHANGES['BID']).length === 0 && _PRICES_BY_EXCHANGES['BID'].constructor === Object)
        ) && !reload
    ) {
        return false;
    }

    if(!do_not_create_progress_bar)
        createProgressBar(160, 'Fetching Prices', Object.keys(config.exchanges).length);

    _PRICES_BY_EXCHANGES = {BID: {}, ASK: {}};
    _PRICES_BY_COINS = {BID: {}, ASK: {}};
    _QUOTES_BY_EXCHANGES = {};
    _EXCHANGES_BY_QUOTES = {};

    let promises = [];

    let data = [];

    for (let exchange_id in config.exchanges){

        if(config.exchanges.hasOwnProperty(exchange_id)) {

            let exchange = config.exchanges[exchange_id];

            let progress_bar_id = exchange_id + ' prices';

            progressBar.startItem( progress_bar_id ) ;

            let promise = (async () => {

                await APISleep(exchange_id);

                return await exchange.fetchTickers();
            })();

            promise.then(function(value){
                data[exchange_id] = value;
                progressBar.itemDone( progress_bar_id );

            }).catch(function(reason) {
                console.log(reason);
                progressBar.itemDone( progress_bar_id );

            });

            promises.push(promise);

        }

    }

    for(let i = 0; i < promises.length; i++){
        try {
            await promises[i];
        }catch(e){

        }
    }

    if(!do_not_create_progress_bar)
        progressBar.stop();

    let i = 0;

    for (let exchange_id in config.exchanges){

        if(config.exchanges.hasOwnProperty(exchange_id)) {

            let tickers = data[exchange_id];

            for(let symbol in tickers){

                if(tickers.hasOwnProperty(symbol)){

                    let ticker = tickers[symbol];

                    if(!ticker || !ticker.hasOwnProperty('bid') || !ticker['bid'])
                        continue;

                    let m = symbol.match(/^([a-z0-9]+)\/([a-z0-9]+)$/i);

                    if(!m || !m[2]) {
                        continue;
                    }

                    if(!_PRICES_BY_EXCHANGES['ASK'][m[2]])
                        _PRICES_BY_EXCHANGES['ASK'][m[2]] = {};

                    if(!_PRICES_BY_EXCHANGES['ASK'][m[2]][exchange_id])
                        _PRICES_BY_EXCHANGES['ASK'][m[2]][exchange_id] = {};
                    if(!_PRICES_BY_COINS['ASK'][m[2]])
                        _PRICES_BY_COINS['ASK'][m[2]] = {};

                    if(!_PRICES_BY_COINS['ASK'][m[2]][m[1]])
                        _PRICES_BY_COINS['ASK'][m[2]][m[1]] = {};


                    if(!_PRICES_BY_EXCHANGES['BID'][m[2]])
                        _PRICES_BY_EXCHANGES['BID'][m[2]] = {};

                    if(!_PRICES_BY_EXCHANGES['BID'][m[2]][exchange_id])
                        _PRICES_BY_EXCHANGES['BID'][m[2]][exchange_id] = {};

                    if(!_PRICES_BY_COINS['BID'][m[2]])
                        _PRICES_BY_COINS['BID'][m[2]] = {};

                    if(!_PRICES_BY_COINS['BID'][m[2]][m[1]])
                        _PRICES_BY_COINS['BID'][m[2]][m[1]] = {};

                    if(!_QUOTES_BY_EXCHANGES[exchange_id])
                        _QUOTES_BY_EXCHANGES[exchange_id] = {};

                    if(!_QUOTES_BY_EXCHANGES[exchange_id][m[2]])
                        _QUOTES_BY_EXCHANGES[exchange_id][m[2]] = 0;

                    if(!_EXCHANGES_BY_QUOTES[m[2]])
                        _EXCHANGES_BY_QUOTES[m[2]] = {};

                    if(!_EXCHANGES_BY_QUOTES[m[2]][exchange_id])
                        _EXCHANGES_BY_QUOTES[m[2]][exchange_id] = 0;


                    _PRICES_BY_EXCHANGES['ASK'][m[2]][exchange_id][m[1]] = ticker['ask'];
                    _PRICES_BY_EXCHANGES['BID'][m[2]][exchange_id][m[1]] = ticker['bid'];
                    _PRICES_BY_COINS['ASK'][m[2]][m[1]][exchange_id] = ticker['ask'];
                    _PRICES_BY_COINS['BID'][m[2]][m[1]][exchange_id] = ticker['bid'];



                    _QUOTES_BY_EXCHANGES[exchange_id][m[2]]++;
                    _EXCHANGES_BY_QUOTES[m[2]][exchange_id]++;


                }

            }

            i++;

        }

    }


    return true;

}

async function getBalances(reload, do_not_create_progress_bar){

    if(!(Object.keys(_BALANCES_BY_COINS).length === 0 && _BALANCES_BY_COINS.constructor === Object) && !reload) {
        return false;
    }

    if(!do_not_create_progress_bar)
        createProgressBar(160, 'Fetching Balances', Object.keys(config.exchanges).length);

    _BALANCES_BY_COINS = {};
    _BALANCES_BY_EXCHANGES = {};

    let promises = [];

    let data = [];

    for (let exchange_id in config.exchanges){

        if(config.exchanges.hasOwnProperty(exchange_id)) {

            let exchange = config.exchanges[exchange_id];

            let progress_bar_id = exchange_id + ' balances';

            progressBar.startItem( progress_bar_id ) ;

            let promise = (async () => {

                await APISleep(exchange_id);

                return await exchange.fetchBalance();
            })();


            promise.then(function(value){
                data[exchange_id] = value;
                progressBar.itemDone( progress_bar_id );
            }).catch(function(reason) {
                progressBar.itemDone( progress_bar_id );
            });

            promises.push(promise);

        }

    }

    for(let i = 0; i < promises.length; i++){
        try {
            await promises[i];
        }catch(e){

        }
    }


    if(!do_not_create_progress_bar)
        progressBar.stop();


    let i = 0;

    for (let exchange_id in config.exchanges){

        if(config.exchanges.hasOwnProperty(exchange_id) && data[exchange_id]) {

            let balance = data[exchange_id];

            if(!_BALANCES_BY_EXCHANGES[exchange_id])
                _BALANCES_BY_EXCHANGES[exchange_id] = {};

            if(!balance.hasOwnProperty('total'))
                continue;

            for (let coin in balance.total) {

                if(balance.total.hasOwnProperty(coin)) {


                    let coin_total_balance = balance.total[coin];

                    if (parseFloat(coin_total_balance) > 0) {

                        if(!_BALANCES_BY_EXCHANGES[exchange_id][coin])
                            _BALANCES_BY_EXCHANGES[exchange_id][coin] = {free: 0, used: 0, total: 0};

                        if(!_BALANCES_BY_COINS[coin])
                            _BALANCES_BY_COINS[coin] = {};

                        if(!_BALANCES_BY_COINS[coin][exchange_id])
                            _BALANCES_BY_COINS[coin][exchange_id] = {free: 0, used: 0, total: 0};

                        if(!_BALANCES_BY_COINS[coin]['_TOTAL'])
                            _BALANCES_BY_COINS[coin]['_TOTAL'] = {free: 0, used: 0, total: 0};

                        _BALANCES_BY_COINS[coin][exchange_id]['free'] = parseFloat(balance['free'][coin]);
                        _BALANCES_BY_COINS[coin][exchange_id]['used'] = parseFloat(balance['used'][coin]);
                        _BALANCES_BY_COINS[coin][exchange_id]['total'] = parseFloat(balance['total'][coin]);
                        _BALANCES_BY_COINS[coin]['_TOTAL']['free'] += parseFloat(balance['free'][coin]);
                        _BALANCES_BY_COINS[coin]['_TOTAL']['used'] += parseFloat(balance['used'][coin]);
                        _BALANCES_BY_COINS[coin]['_TOTAL']['total'] += parseFloat(balance['total'][coin]);

                        _BALANCES_BY_EXCHANGES[exchange_id][coin]['free'] = parseFloat(balance['free'][coin]);
                        _BALANCES_BY_EXCHANGES[exchange_id][coin]['used'] = parseFloat(balance['used'][coin]);
                        _BALANCES_BY_EXCHANGES[exchange_id][coin]['total'] = parseFloat(balance['total'][coin]);

                    }
                }

            }

            i++;

        }

    }

    return true;

}


// -----------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------
// ------------------------------------------- MAIN CODE -----------------------------------------------
// -----------------------------------------------------------------------------------------------------
// -----------------------------------------------------------------------------------------------------


// lets immediately start fetching in background;

term.on( 'key' , function( name , matches , data ) {
    if ( name === 'CTRL_C' ) { terminate() ; }
} ) ;


terminal.nl();
terminal.showLine();
terminal.showCentered('[TRADING CONTROL PANEL]','=');
terminal.showCentered('version 20180116','=');
terminal.showLine();

function mainSectionMenu(){

    terminal.nl();
    terminal.showCentered('Main menu [' + _SELECTED_QUOTE +']', '-');
    terminal.nl();

    let item7 = "7. Show BTC / USD chart (" + config.exchange_for_fiat.describe()['name'] + ")";

    if(_SELECTED_QUOTE === 'ETH'){
        item7 = "7. Show ETH / USD chart (" + config.exchange_for_fiat.describe()['name'] + ")";
    }

    let items = [
        "1. Exchange - view rates and stats",
        "2. Orders - place new orders, edit existing [NOT IMPLEMENTED]",
        "3. Balance - check out how much you have of what",
        "4. Cross-stock analysis",
        "5. Cross-currency analysis",
        "6. Change quote (active: "+_SELECTED_QUOTE+")",
        item7,
        "8. Refresh balances and prices",
        "9. Encrypt config",
    ];

    terminal.writeLine('What do you want to do? ');

    term.singleColumnMenu( items , function( error , response ) {

        mainSection(parseInt(response.selectedIndex) + 1);

    } ) ;

}

async function mainSection(option){
    if(!option){
        mainSectionMenu();
        return;
    }

    switch(parseInt(option)){
        case 1:
            exchangeSection();
            return;

        case 2:

            break;

        case 3:
            balanceSection();
            return;

        case 4:
            crossStockSection();
            return;

        case 5:
            crossCurrencySection();
            return;

        case 6:
            changeQuoteSection();
            return;

        case 7:
            if(_SELECTED_QUOTE === 'ETH')
                ethereumPriceChart();
            else
                bitcoinPriceChart();

            return;

        case 8:
            await getPricesAndBalances(true);
            break;

        case 9:
            encryptConfigSection();
            return;

    }

    mainSectionMenu();
    return;

}


function encryptConfigSection(password, confirm_password) {

    if(!password) {
        terminal.nl();
        terminal.showCentered('Encrypt your API key and secret values from config.json file.', '-');
        terminal.nl();
        terminal.showLine('=');
        terminal.showLine('=');
        terminal.showCentered('WARNING! Losing this password will cause loss of API keys and secrets', '=');
        terminal.showCentered('make sure you have these backed up securely', '=');
        terminal.showLine('=');
        terminal.showLine('=');
        terminal.nl();
        terminal.nl();
        terminal.writeLine('Enter new password:');
        terminal.nl();

        term.inputField(
            function (error, input) {
                if (input && input.length > 0) {
                    encryptConfigSection(input);
                } else {
                    terminal.writeLine('Invalid input. Aborting.');
                    mainSection();
                    return;
                }
            }
        );

        return;
    }

    if(!confirm_password){

        terminal.nl();
        terminal.writeLine('Please confirm password:');
        terminal.nl();

        term.inputField(
            function (error, input) {
                if (input && input.length > 0) {
                    encryptConfigSection(password, input);
                } else {
                    terminal.writeLine('Invalid input. Aborting.');
                    mainSection();
                    return;
                }
            }
        );

        return;
    }

    if(password === confirm_password){
        config.saveConfig(password);
        terminal.nl();
        terminal.nl();
        terminal.writeLine('Password changed successfully. On next launch, app will ask for it. Make sure to save it');
        terminal.nl();
        mainSection();
        return;
    }else{
        terminal.writeLine('Passwords do not match');
        encryptConfigSection();
        return;
    }



}

async function quotePriceChart(coin, currency){

    createProgressBar(160, 'Fetching '+coin+' / '+currency, 1);

    let exchange_name = config.exchange_for_fiat.describe()['name'];
    progressBar.startItem(exchange_name);

    try {

        let ohlcv = await config.exchange_for_fiat.fetchOHLCV(coin + '/' + currency, '2h', Date.now() - 604800000, 84);

        let series = ohlcv.map (x => x[4]) ;        // index = [ timestamp, open, high, low, close, volume ]

        let time_start = ohlcv[0][0];
        let time_end = ohlcv[ohlcv.length - 1][0];

        priceChart('1 week '+coin+' / '+currency+' (' + exchange_name + ')', series, coinSymbolChar(coin), coinSymbolChar(currency), 2, time_start, time_end);
    }catch (e){
        console.log(e);
    }

    progressBar.itemDone(exchange_name);

}

async function bitcoinPriceChart(){
    await quotePriceChart('BTC', _SELECTED_CURRENCY);

    mainSection();
}

async function ethereumPriceChart(){
    await quotePriceChart('ETH', _SELECTED_CURRENCY);

    mainSection();
}

function priceChart(title, series, symbol, quote, precision, timeStart, timeEnd){

    terminal.nl();
    terminal.nl();
    terminal.showCentered(title, '-');
    terminal.showCentered(getYmdHisDate(timeStart)+' - '+ getYmdHisDate(timeEnd), '-');
    terminal.nl();

    if(!series)
        return;

    if(!precision)
        precision = 0;

    let asciichart = require ('asciichart');
    let log        = require ('ololog').configure ({ locate: false });

    require('ansicolor').nice;

    series = series.slice(-96);

    let firstPrice = series[0]; // closing price
    let lastPrice = series[series.length - 1]; // closing price
    let difference = (lastPrice/firstPrice -1)*100;

    if(difference < 0){
        difference = (terminal.number_format(difference,2)+'%').red;
    }else{
        difference = ('+'+terminal.number_format(difference,2)+'%').green;
    }
    let padding = '                ';

    let quoteRate = (symbol + ' = ' + quote + lastPrice).green;
    let chart = asciichart.plot(series, { height: 15, format: function (x) {
            return (padding + quote + terminal.number_format(x, precision)).slice(-padding.length);
    } });



    log.yellow ("\n" + chart,"\n", padding + '  '+quoteRate, "\n",padding+"  Change "+terminal.niceTimeFormat((timeEnd - timeStart)/1000)+": ",difference, "\n");

    terminal.nl();

}

function convertSymbolToCoinMarketCapSymbol(symbol) {

    switch (symbol.toUpperCase()){
        case 'IOTA':
            return 'MIOTA';
        case 'QSH':
            return 'QASH';
    }

    return symbol;
}
// ------------------------------------------- BALANCE -----------------------------------------------

async function balanceSection(){

    terminal.nl();
    terminal.nl();
    terminal.showCentered('Balances [' + _SELECTED_QUOTE + ']', '-');
    terminal.nl();

    await getPricesAndBalances();

    terminal.nl();
    terminal.nl();
    terminal.showCentered(_SELECTED_QUOTE+" TOTAL Balance: " + terminal.number_format(getArrayItem(_BALANCES_BY_COINS, _SELECTED_QUOTE, '_TOTAL', 'total'),8), ' ');
    terminal.showCentered(_SELECTED_QUOTE+" Available Balance: " + terminal.number_format(getArrayItem(_BALANCES_BY_COINS, _SELECTED_QUOTE, '_TOTAL', 'free'),8), ' ');
    terminal.showCentered(_SELECTED_QUOTE+" Locked Balance: " + terminal.number_format(getArrayItem(_BALANCES_BY_COINS, _SELECTED_QUOTE, '_TOTAL', 'used'),8),' ');
    terminal.nl();

    let t = new Table({
        borderStyle: 3,
        horizontalLine: true,
        rightPadding: 1,
        leftPadding: 1,
        align: 'right'

    });

    let columns = ["Coin", "Total", "%", "Market ppm", "Change w/d/h"];

    t.attrRange({row: [0, 1]}, {
        align: "center",
        color: "blue",
        bg: "black"
    });

    let data = [];

    let first_iteration = true;

    let quote_value_overall = 0;

    let total_row = ['TOTAL',0,0,0];

    //for ($_BALANCES_BY_COINS as $symbol => $balance){
    for (let symbol in _BALANCES_BY_COINS){

        if(!_BALANCES_BY_COINS.hasOwnProperty(symbol))
            continue;

        let balance = _BALANCES_BY_COINS[symbol];

        let total = parseFloat(balance['_TOTAL']['total']);

        if(total <= 0)
            continue;

        let row = [
            symbol,
            null,
            null,
            null,
            null,
        ];

        let quote_value_total = 0;


        let i = 5;
        //foreach($_BALANCES_BY_EXCHANGES as $exchange_id => $coins) {
        for(let exchange_id in _BALANCES_BY_EXCHANGES) {

            if(!_BALANCES_BY_EXCHANGES.hasOwnProperty(exchange_id))
                continue;

            let coins = _BALANCES_BY_EXCHANGES[exchange_id];

            let coins_total = 0;

            if(coins[symbol])
                coins_total = parseFloat(getArrayItem(coins,symbol,'total'));

            if(!_QUOTES_BY_EXCHANGES[exchange_id] || !_QUOTES_BY_EXCHANGES[exchange_id][_SELECTED_QUOTE])
                continue;

            if (first_iteration) {
                let exchange_details = config.exchanges[exchange_id].describe();

                columns.push(exchange_details['name']);
            }

            let quote_value = coins_total;


            if(symbol !== _SELECTED_QUOTE) {

                let price_for_calculation = 0;

                if(_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE][exchange_id][symbol])
                    price_for_calculation = parseFloat(_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE][exchange_id][symbol]);

                quote_value *= price_for_calculation;
            }

            quote_value_total += quote_value;

            if(!total_row[i])
                total_row[i] = 0;

            total_row[i++] += quote_value;

            if(symbol === _SELECTED_QUOTE)
                row.push(terminal.number_format(coins_total,3)+' '+coinSymbolChar(_SELECTED_QUOTE));
            else
                row.push(coins_total ? terminal.number_format(quote_value, 3)+' '+coinSymbolChar(_SELECTED_QUOTE) : '-');

        }

        quote_value_overall += quote_value_total;


        first_iteration = false;

        if(quote_value_total < 0.001 && symbol !== _SELECTED_QUOTE)
            continue;

        let symbol_for_coinmarketcap = convertSymbolToCoinMarketCapSymbol(symbol);

        let market_cap = parseFloat(getArrayItem(_COINMARKETCAP_COINS, _SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE, symbol_for_coinmarketcap, 'market_cap'));

        if(market_cap && market_cap > 0) {

            let market_ppm = quote_value_total / market_cap * 1000000;
            row[3] = terminal.number_format(market_ppm, 3)+' ppm';

        }

        let change1h = parseFloat(getArrayItem(_COINMARKETCAP_COINS, _SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE, symbol_for_coinmarketcap, 'percent_change_1h'));
        let change24h = parseFloat(getArrayItem(_COINMARKETCAP_COINS, _SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE, symbol_for_coinmarketcap, 'percent_change_24h'));
        let change7d = parseFloat(getArrayItem(_COINMARKETCAP_COINS, _SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE, symbol_for_coinmarketcap, 'percent_change_7d'));


        row[1] = terminal.number_format(total,3) + ' | '+ terminal.number_format(quote_value_total, 3)+' '+coinSymbolChar(_SELECTED_QUOTE);
        row[2] = quote_value_total;

        row[4] = terminal.number_format(change7d,0)+'% '+terminal.number_format(change24h,0)+'% '+terminal.number_format(change1h,0)+'%';

        data.push(row);

    }


    t.push(columns);

    data.sort(function(a, b) {

        if(a[0] === _SELECTED_QUOTE)
            return -1;

        if(b[0] === _SELECTED_QUOTE)
            return 1;

        return parseFloat(b[2]) - parseFloat(a[2]);
    });

    for(let row_id in data){
        let percentage = data[row_id][2]/quote_value_overall*100;
        data[row_id][2] = terminal.number_format(percentage,1)+ '%';
        total_row[2] += percentage;
        t.push(data[row_id]);
    }

    total_row[1] = terminal.number_format(quote_value_overall, 5)+' '+coinSymbolChar(_SELECTED_QUOTE);
    total_row[2] = terminal.number_format(total_row[2], 1)+'%';

    total_row[3] = '-';
    total_row[4] = '-';

    for(let i = 5; i < columns.length; i++){
        total_row[i] = terminal.number_format(total_row[i], 3)+' '+coinSymbolChar(_SELECTED_QUOTE);
    }

    t.push(total_row);

    t.attrRange(
        {
            column: [1, columns.length],
            row: [1, data.length+2]
        },
        {align: "right"}
    );
    t.attrRange(
        {
            row: [data.length+1,data.length+2]
        },
        {bg: "black"}
    );

    terminal.writeLine("" + t);

    mainSection();

}

function changeQuoteSectionMenu(){


    terminal.nl();
    terminal.writeLine("These quotes are available on active stocks:");
    terminal.nl();

    let new_quote = '';

    let items = [];

    for (let quote in _EXCHANGES_BY_QUOTES){
        if(!_EXCHANGES_BY_QUOTES.hasOwnProperty(quote))
            continue;

        terminal.write("\t- "+quote+" (");

        let first_iteration = true;

        items.push(quote);

        //foreach ($exchanges as $exchange_id => $options) {
        for(let exchange_id in _EXCHANGES_BY_QUOTES[quote]) {


            if(!_EXCHANGES_BY_QUOTES[quote].hasOwnProperty(exchange_id))
                continue;


            let options = _EXCHANGES_BY_QUOTES[quote][exchange_id];

            let exchange_details = config.exchanges[exchange_id].describe();

            if (first_iteration)
                first_iteration = false;
            else
                terminal.write(", ");

            terminal.write(exchange_details['name'] + " [" + options + "]");
        }

        terminal.nl();
    }

    terminal.nl();

    terminal.writeLine('What quote would you like to use? ');

    term.gridMenu( items , function( error , response ) {

        changeQuoteSection(response.selectedText);

    } ) ;

}


function exchangeSelectCoinMenu(){

    terminal.nl();
    terminal.writeLine("What coin?");

    let items = [];

    for (let coin in _PRICES_BY_COINS['BID'][_SELECTED_QUOTE]){
        if(!_PRICES_BY_COINS['BID'][_SELECTED_QUOTE].hasOwnProperty(coin))
            continue;

        items.push(coin);

    }

    term.inputField(
        {autoComplete: items , autoCompleteMenu: true } ,
        function( error , input ) {
            console.log(error);
            exchangeSection(input);
            return;
        }
    ) ;

}


function exchangeSelectActionMenu(selected_coin){

    terminal.nl();
    terminal.writeLine("What do you want to do? ");
    terminal.nl();

    let items = [
        "1. Buy "+selected_coin+" for "+ _SELECTED_QUOTE,
        "2. Sell "+selected_coin+" for "+ _SELECTED_QUOTE,
        "3. OHLCV charts",
        "4. Cancel open order",
        "5. Change coin",
        "6. Refresh page",
        "7. Main menu",
    ];


    term.singleColumnMenu( items , function( error , response ) {

        if(response) {

            let selected_index = parseInt(response.selectedIndex);

            switch (selected_index + 1) {

                case 1:
                    // buy
                    buyWizzard(selected_coin);
                    return;

                case 2:
                    // sell
                    sellWizzard(selected_coin);
                    return;

                case 3:
                    // chart
                    exchangeOHLCVMenu(selected_coin);
                    return;

                case 4:
                    exchangeCancelOrder(selected_coin);
                    return;

                case 5:
                    exchangeSelectCoinMenu();
                    return;

                case 6:
                    exchangeSection(selected_coin, true);
                    return;

                case 7:
                    mainSection();
                    return;

            }

        }

        mainSection();
        return;

    } ) ;

}

async function sellWizzard(selected_coin, selected_exchange_id, selected_type, price, spend, execute){
    // what exchange to buy on?

    if(!selected_coin){
        exchangeSection();
        return;
    }

    if(!selected_exchange_id) {
        let items = [];

        // get list of possible exchanges (must support coin AND they must have fetchOHLCV)
        for (let exchange_id in config.exchanges) {

            let balance = parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES,exchange_id,selected_coin, 'free'));

            if(!balance)
                continue;

            if (!config.exchanges.hasOwnProperty(exchange_id) || !_PRICES_BY_EXCHANGES['ASK'][_SELECTED_QUOTE] || !_PRICES_BY_EXCHANGES['ASK'][_SELECTED_QUOTE][exchange_id] || !_PRICES_BY_EXCHANGES['ASK'][_SELECTED_QUOTE][exchange_id][selected_coin] || balance < 0.0000001)
                continue;

            items.push(exchange_id);
        }

        // we dont have any possible exchange -> error message and return to exchange
        if (items.length === 0) {
            terminal.writeLine('No exchanges support '+selected_coin+'/'+_SELECTED_QUOTE);
            exchangeSelectActionMenu(selected_coin);
            return;
        }

        terminal.nl();
        terminal.writeLine('What exchange market?');

        term.singleColumnMenu(items, function (error, response) {
            sellWizzard(selected_coin, response.selectedText);
        });

        return;
    }


    if(!selected_type) {
        let items = ['1. MARKET','2. LIMIT'];

        terminal.nl();
        terminal.writeLine('What order type?');

        term.singleColumnMenu(items, function (error, response) {

            let type = 'MARKET';

            if(response.selectedIndex === 1)
                type = 'LIMIT';

            sellWizzard(selected_coin, selected_exchange_id, type);
            return;

        });

        return;
    }

    let min_bid_price = getArrayItem(_PRICES_BY_EXCHANGES, 'BID', _SELECTED_QUOTE, selected_exchange_id, selected_coin);

    if(selected_type === 'LIMIT' && !price){
        terminal.nl();

        // how much sell for
        terminal.writeLine('How much do you want to sell for? The min ASK price is: '+terminal.number_format(min_bid_price, 8) +' '+coinSymbolChar(_SELECTED_QUOTE));

        term.inputField(
            function( error , input ) {

                let m = input.match(/([\d\.]+)(%)?/);

                if(!m || !m[1]){
                    terminal.nl();
                    terminal.writeLine('Invalid amount.');
                    sellWizzard(selected_coin, selected_exchange_id, selected_type);
                    return;
                }

                price = parseFloat(m[1]);

                if(m[2] && m[2] === '%'){
                    price = price / 100 * min_bid_price;
                }

                if(price < 0.00000001){

                    terminal.nl();
                    terminal.writeLine('Amount too small.');
                    sellWizzard(selected_coin, selected_exchange_id, selected_type);
                    return;
                }

                sellWizzard(selected_coin, selected_exchange_id, selected_type, price);
                return;

            }
        );

        return;

    }

    let market = config.exchanges[selected_exchange_id].market(selected_coin+'/'+_SELECTED_QUOTE);

    // show prices
    if(!spend) {
        terminal.nl();
        terminal.showCentered(selected_coin + ' available balance: ' + terminal.number_format(getArrayItem(_BALANCES_BY_EXCHANGES, selected_exchange_id, selected_coin, 'free'), 8));
        terminal.showCentered(selected_coin + ' price: ' + terminal.number_format(getArrayItem(_PRICES_BY_EXCHANGES, 'ASK', _SELECTED_QUOTE, selected_exchange_id, selected_coin), 8));
        terminal.showCentered(selected_coin + ' targeted price: ' + terminal.number_format(price, market.precision.price));
        terminal.nl();
        // how much spend

        terminal.writeLine('How much do you want to sell? You can enter '+selected_coin+' amount or %:');

        term.inputField(
            function( error , input ) {

                let m = input.match(/([\d\.]+)(%)?/);

                if(!m || !m[1]){
                    terminal.writeLine('Invalid amount.');
                    sellWizzard(selected_coin, selected_exchange_id, selected_type, price);
                    return;
                }

                spend = parseFloat(m[1]);

                let totalQuote = parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES, selected_exchange_id, selected_coin, 'free'));

                if(m[2] && m[2] === '%'){
                    spend = spend / 100 * totalQuote;
                }

                if(spend < 0.001){
                    terminal.writeLine('Amount too small.');
                    sellWizzard(selected_coin, selected_exchange_id, selected_type, price);
                    return;
                }

                if(spend > totalQuote){
                    terminal.writeLine('Amount too big.');
                    sellWizzard(selected_coin, selected_exchange_id, selected_type, price);
                    return;
                }

                sellWizzard(selected_coin, selected_exchange_id, selected_type, price, spend);
                return;

            }
        );

        return;

    }

    if(!price)
        price = min_bid_price;

    price = parseFloat(price);
    price = price.toFixed(market.precision.price);

    spend = parseFloat(spend);
    spend.toFixed(market.precision.amount);

    // yes/no
    let how_much_I_get = spend * price;
    how_much_I_get = how_much_I_get.toFixed(market.precision.amount);

    if(!execute){

        terminal.nl();
        terminal.showLine('=');
        terminal.showLine('=');
        terminal.showCentered('Exchange: ' + config.exchanges[selected_exchange_id].describe()['name']);
        terminal.showCentered('Order type : ' + selected_type);
        terminal.showCentered('Market : ' + selected_coin + '/' + _SELECTED_QUOTE);
        terminal.showCentered('SELL ' + terminal.number_format(spend, market.precision.amount) + ' ' + selected_coin + ' for ' + terminal.number_format(how_much_I_get, market.precision.price) + ' ' + coinSymbolChar(_SELECTED_QUOTE) + ' (' + terminal.number_format(parseFloat(price) / min_bid_price * 100, 2) + '% of min BID price)');
        terminal.showLine('=');
        terminal.showLine('=');

        terminal.nl();
        terminal.nl();

        term( 'Do you want to execute this order? [y/N]\n' ) ;

        // Exit on y and ENTER key
        // Ask again on n
        term.yesOrNo( { yes: [ 'y', 'Y'] , no: [ 'n', 'N', 'ENTER' ] } , function( error , result ) {

            if ( result )
            {
                sellWizzard(selected_coin, selected_exchange_id, selected_type, price, spend, true);
                return;
            }
            else
            {
                terminal.nl();
                terminal.writeLine('Aborting. Not executed.');
                exchangeSection(selected_coin);
                return;
            }
        } ) ;

        return;
    }

    createProgressBar(160, 'Submit order', 1);

    try {
        progressBar.startItem('Sending');

        await APISleep(selected_exchange_id);
        let order_details = await config.exchanges[selected_exchange_id].createOrder(selected_coin + '/' + _SELECTED_QUOTE, selected_type.toLowerCase(), 'sell', spend, price);

        progressBar.itemDone('Sending');
        progressBar.update(1);
        progressBar.stop();

        terminal.nl();
        terminal.nl();
        terminal.writeLine('Order #' + order_details['id'] + ' has been placed!');

        //todo go to open orders

    }catch(e) {

        progressBar.itemDone('Sending');
        progressBar.update(1);
        progressBar.stop();
        terminal.nl();
        terminal.showLine('-');
        terminal.writeLine('ERROR! ORDER NOT PLACED!');
        terminal.showLine('-');
        console.log(e);
        terminal.showLine('-');
        terminal.nl();

    }

    //go
    exchangeSection(selected_coin, true);
}

async function buyWizzard(selected_coin, selected_exchange_id, selected_type, price, spend, execute){
    // what exchange to buy on?

    if(!selected_coin){
        exchangeSection();
        return;
    }

    if(!selected_exchange_id) {
        let items = [];

        // get list of possible exchanges (must support coin AND they must have fetchOHLCV)
        for (let exchange_id in config.exchanges) {
            if (!config.exchanges.hasOwnProperty(exchange_id) || !_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE] || !_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE][exchange_id] || !_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE][exchange_id][selected_coin])
                continue;

            items.push(exchange_id);
        }

        // we dont have any possible exchange -> error message and return to exchange
        if (items.length === 0) {
            terminal.writeLine('No exchanges support '+selected_coin+'/'+_SELECTED_QUOTE);
            exchangeSelectActionMenu(selected_coin);
            return;
        }

        terminal.nl();
        terminal.writeLine('What exchange market?');

        term.singleColumnMenu(items, function (error, response) {
            buyWizzard(selected_coin, response.selectedText);
        });

        return;
    }


    if(!selected_type) {
        let items = ['1. MARKET','2. LIMIT'];

        terminal.nl();
        terminal.writeLine('What order type?');

        term.singleColumnMenu(items, function (error, response) {

            let type = 'MARKET';

            if(response.selectedIndex === 1)
                type = 'LIMIT';

            buyWizzard(selected_coin, selected_exchange_id, type);
            return;

        });

        return;
    }

    let min_ask_price = getArrayItem(_PRICES_BY_EXCHANGES, 'ASK', _SELECTED_QUOTE, selected_exchange_id, selected_coin);

    if(selected_type === 'LIMIT' && !price){
        terminal.nl();
        // how much spend

        terminal.writeLine('How much do you want to pay? The min ASK price is: '+terminal.number_format(min_ask_price, 8) +' '+coinSymbolChar(_SELECTED_QUOTE));

        term.inputField(
            function( error , input ) {

                let m = input.match(/([\d\.]+)(%)?/);

                if(!m || !m[1]){
                    terminal.nl();
                    terminal.writeLine('Invalid amount.');
                    buyWizzard(selected_coin, selected_exchange_id, selected_type);
                    return;
                }

                price = parseFloat(m[1]);

                if(m[2] && m[2] === '%'){
                    price = price / 100 * min_ask_price;
                }

                if(price < 0.00000001){

                    terminal.nl();
                    terminal.writeLine('Amount too small.');
                    buyWizzard(selected_coin, selected_exchange_id, selected_type);
                    return;
                }

                buyWizzard(selected_coin, selected_exchange_id, selected_type, price);
                return;

            }
        );

        return;

    }

    let market = config.exchanges[selected_exchange_id].market(selected_coin+'/'+_SELECTED_QUOTE);

    // show prices
    if(!spend) {
        terminal.nl();
        terminal.showCentered(_SELECTED_QUOTE + ' available balance: ' + terminal.number_format(getArrayItem(_BALANCES_BY_EXCHANGES, selected_exchange_id, _SELECTED_QUOTE, 'free'), 8));
        terminal.showCentered(selected_coin + ' price: ' + terminal.number_format(getArrayItem(_PRICES_BY_EXCHANGES, 'ASK', _SELECTED_QUOTE, selected_exchange_id, selected_coin), 8));
        terminal.nl();
        // how much spend

        terminal.writeLine('How much do you want to spend? You can enter '+_SELECTED_QUOTE+' amount or %:');

        term.inputField(
            function( error , input ) {

                let m = input.match(/([\d\.]+)(%)?/);

                if(!m || !m[1]){
                    terminal.writeLine('Invalid amount.');
                    buyWizzard(selected_coin, selected_exchange_id, selected_type, price);
                    return;
                }

                spend = parseFloat(m[1]);

                let totalQuote = parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES, selected_exchange_id, _SELECTED_QUOTE, 'free'));

                if(m[2] && m[2] === '%'){
                    spend = spend / 100 * totalQuote;
                }

                if(spend < 0.001){
                    terminal.writeLine('Amount too small.');
                    buyWizzard(selected_coin, selected_exchange_id, selected_type, price);
                    return;
                }

                if(spend > totalQuote){
                    terminal.writeLine('Amount too big.');
                    buyWizzard(selected_coin, selected_exchange_id, selected_type, price);
                    return;
                }

                buyWizzard(selected_coin, selected_exchange_id, selected_type, price, spend);
                return;

            }
        );

        return;

    }

    if(!price)
        price = min_ask_price;

    price = parseFloat(price);
    price = price.toFixed(market.precision.price);

    // yes/no
    let how_much_I_get = spend / price;
    how_much_I_get = how_much_I_get.toFixed(market.precision.amount);

    if(!execute){

        terminal.nl();
        terminal.showLine('=');
        terminal.showLine('=');
        terminal.showCentered('Exchange: ' + config.exchanges[selected_exchange_id].describe()['name']);
        terminal.showCentered('Order type : ' + selected_type);
        terminal.showCentered('Market : ' + selected_coin + '/' + _SELECTED_QUOTE);
        terminal.showCentered('BUY ' + terminal.number_format(how_much_I_get, market.precision.amount) + ' ' + selected_coin + ' for ' + terminal.number_format(spend, market.precision.price) + ' ' + coinSymbolChar(_SELECTED_QUOTE) + ' (' + terminal.number_format(parseFloat(price) / min_ask_price * 100, 2) + '% of min ASK price)');
        terminal.showLine('=');
        terminal.showLine('=');

        terminal.nl();
        terminal.nl();

        term( 'Do you want to execute this order? [y/N]\n' ) ;

        // Exit on y and ENTER key
        // Ask again on n
        term.yesOrNo( { yes: [ 'y', 'Y'] , no: [ 'n', 'N', 'ENTER' ] } , function( error , result ) {

            if ( result )
            {
                buyWizzard(selected_coin, selected_exchange_id, selected_type, price, spend, true);
                return;
            }
            else
            {
                terminal.nl();
                terminal.writeLine('Aborting. Not executed.');
                exchangeSection(selected_coin);
                return;
            }
        } ) ;

        return;
    }

    createProgressBar(160, 'Submit order', 1);

    try {
        progressBar.startItem('Sending');

        let params = {};

        if(selected_exchange_id === 'okex' && selected_type === 'LIMIT' ){
            params['cost'] = price * how_much_I_get;
        }

        await APISleep(selected_exchange_id);
        let order_details = await config.exchanges[selected_exchange_id].createOrder(selected_coin + '/' + _SELECTED_QUOTE, selected_type.toLowerCase(), 'buy', how_much_I_get, price, params);

        progressBar.itemDone('Sending');
        progressBar.update(1);
        progressBar.stop();

        terminal.nl();
        terminal.nl();
        terminal.writeLine('Order #' + order_details['id'] + ' has been placed!');

        //todo go to open orders

    }catch(e) {

        progressBar.itemDone('Sending');
        progressBar.update(1);
        progressBar.stop();
        terminal.nl();
        terminal.showLine('-');
        terminal.writeLine('ERROR! ORDER NOT PLACED!');
        terminal.showLine('-');
        console.log(e);
        terminal.showLine('-');
        terminal.nl();

    }

    //go
    exchangeSection(selected_coin, true);
}

function isNumeric(n) {
    return !isNaN(parseFloat(n)) && isFinite(n);
}

function getTimeFrameSeconds(seconds){
    if(isNumeric(seconds))
        return seconds;

    let m = seconds.match(/(\d+)([a-z]+)$/i);

    if(m && m[1] && m[2]){
        let total = parseInt(m[1]);

        switch(m[2]){
            case 's':
            case 'sec':
                return total;
            case 'm':
            case 'min':
                return total * 60;
            case 'h':
            case 'hour':
            case 'H':
                return total * 3600;
            case 'd':
            case 'day':
            case 'D':
                return total * 86400;
            case 'w':
            case 'week':
            case 'W':
                return total * 604800;
            case 'M':
            case 'month':
                return total * 2592000;
            case 'y':
            case 'year':
            case 'Y':
                return total * 31536000;
        }
    }


    //console.log(m);
    //process.exit();

    return 0;
}

async function exchangeCancelOrder(selected_coin, selected_exchange_id, selected_order_id, execute) {
    // what exchange ?

    if(!selected_exchange_id) {
        let items = [];

        if(_OPEN_ORDERS.hasOwnProperty(selected_coin+'/'+_SELECTED_QUOTE)) {
            // get list of possible exchanges (must support coin AND they must have fetchOHLCV)
            for (let exchange_id in _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE]) {
                if (!_OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE].hasOwnProperty(exchange_id))
                    continue;

                items.push(exchange_id);
            }
        }

        // we dont have any possible exchange -> error message and return to exchange
        if (items.length === 0) {
            terminal.writeLine('No open orders');
            exchangeSelectActionMenu(selected_coin);
            return;
        }

        terminal.nl();
        terminal.writeLine('What exchange market?');

        term.singleColumnMenu(items, function (error, response) {
            exchangeCancelOrder(selected_coin, response.selectedText);
        });

        return;
    }

    if(!selected_order_id) {
        let items = [];

        if(_OPEN_ORDERS[selected_coin+'/'+_SELECTED_QUOTE].hasOwnProperty(selected_exchange_id)) {
            // get list of possible exchanges (must support coin AND they must have fetchOHLCV)
            for (let order_id in _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id]) {
                if (!_OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id].hasOwnProperty(order_id))
                    continue;

                items.push(order_id);
            }
        }

        // we dont have any possible exchange -> error message and return to exchange
        if (items.length === 0) {
            terminal.writeLine('No open orders');
            exchangeSelectActionMenu(selected_coin);
            return;
        }

        terminal.nl();
        terminal.writeLine('What exchange market?');

        term.singleColumnMenu(items, function (error, response) {
            exchangeCancelOrder(selected_coin, selected_exchange_id, response.selectedText);
        });

        return;
    }


    if(!execute){


        let market = config.exchanges[selected_exchange_id].market(selected_coin+'/'+_SELECTED_QUOTE);

        terminal.nl();
        terminal.showLine('=');
        terminal.showLine('=');
        terminal.showCentered('Exchange: ' + config.exchanges[selected_exchange_id].describe()['name']);
        terminal.showCentered('Order ID : ' + selected_order_id);
        terminal.showCentered('Side : ' + _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['side'].toUpperCase());
        terminal.showCentered('Symbol : ' + _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['symbol']);
        terminal.showCentered('Type : ' + _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['type'].toUpperCase());
        terminal.showCentered('Price : ' + terminal.number_format(+ _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['price'],market.precision.price) + ' ' + coinSymbolChar(_SELECTED_QUOTE));
        terminal.showCentered('Cost : ' + terminal.number_format(+ _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['cost'],market.precision.price) + ' ' + coinSymbolChar(_SELECTED_QUOTE));
        terminal.showCentered('Amount : ' + terminal.number_format(+ _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['amount'],market.precision.amount) + ' ' + selected_coin);
        terminal.showCentered('Filled : ' + terminal.number_format(+ _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['filled'],market.precision.amount) + ' ' + selected_coin);
        terminal.showLine('=');
        terminal.showLine('=');

        terminal.nl();
        terminal.nl();

        term( 'Do you want to cancel this order? [y/N]\n' ) ;

        // Exit on y and ENTER key
        // Ask again on n
        term.yesOrNo( { yes: [ 'y', 'Y'] , no: [ 'n', 'N', 'ENTER' ] } , function( error , result ) {

            if ( result )
            {
                exchangeCancelOrder(selected_coin, selected_exchange_id, selected_order_id, true);
                return;
            }
            else
            {
                terminal.nl();
                terminal.writeLine('Aborting. Not executed.');
                exchangeSection(selected_coin);
                return;
            }
        } ) ;

        return;
    }


    createProgressBar(160, 'Cancel order', 1);

    try {
        progressBar.startItem('Sending');

        await APISleep(selected_exchange_id);

        let params = {};

        if(selected_exchange_id === 'kucoin')
            params = {type: _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['side'].toUpperCase()};

        let canceled_order_details = await config.exchanges[selected_exchange_id].cancelOrder(selected_order_id, _OPEN_ORDERS[selected_coin + '/' + _SELECTED_QUOTE][selected_exchange_id][selected_order_id]['symbol'], params);

        progressBar.itemDone('Sending');
        progressBar.update(1);
        progressBar.stop();

        terminal.nl();
        terminal.nl();

        if(canceled_order_details) {
            terminal.writeLine('Order #' + selected_order_id + ' has been canceled!');
            console.log(canceled_order_details);
        } else {
            terminal.writeLine('!!!! ERROR - Order #' + selected_order_id + ' has NOT been canceled !!!!');
            console.log(canceled_order_details);
        }
    }catch(e) {

        progressBar.itemDone('Sending');
        progressBar.update(1);
        progressBar.stop();
        terminal.nl();
        terminal.showLine('-');
        terminal.writeLine('ERROR! ORDER NOT CANCELED!');
        terminal.showLine('-');
        console.log(e);
        terminal.showLine('-');
        terminal.nl();

    }

    //go
    exchangeSection(selected_coin, true);

}


async function exchangeOHLCVMenu(selected_coin, selected_exchange_id, selected_time_frame, do_not_return_to_exchange_menu, do_not_create_progress_bar, return_function_that_draws) {
    // what exchange?

    if (!selected_exchange_id) {
        let items = [];

        // get list of possible exchanges (must support coin AND they must have fetchOHLCV)
        for (let exchange_id in config.exchanges) {
            if (!config.exchanges.hasOwnProperty(exchange_id) || !config.exchanges[exchange_id].hasFetchOHLCV || !_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE] || !_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE][exchange_id] || !_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE][exchange_id][selected_coin])
                continue;

            items.push(exchange_id);
        }

        // we dont have any possible exchange -> error message and return to exchange
        if (items.length === 0) {
            terminal.writeLine('No exchanges support OHLCV Charts');
            exchangeSelectActionMenu(selected_coin);
            return;
        }

        terminal.nl();
        terminal.writeLine('What exchange market?');

        term.singleColumnMenu(items, function (error, response) {
            exchangeOHLCVMenu(selected_coin, response.selectedText);
        });

        return;
    }

    if (!config.exchanges[selected_exchange_id].hasFetchOHLCV)
        return;

    if (!selected_time_frame) {
        let items = [];
        let items_ids = [];

        // get list of possible exchanges (must support coin AND they must have fetchOHLCV)
        for (let time_frame in config.exchanges[selected_exchange_id].timeframes) {
            if (!config.exchanges[selected_exchange_id].timeframes.hasOwnProperty(time_frame))
                continue;

            items_ids.push(time_frame);

            let time_frame_seconds = getTimeFrameSeconds(config.exchanges[selected_exchange_id].timeframes[time_frame]);

            items.push(time_frame + ' ' + terminal.niceTimeFormat(time_frame_seconds) + ' (Period: ' + terminal.niceTimeFormat(time_frame_seconds * 96) + ')');
        }

        // we dont have any possible exchange -> error message and return to exchange
        if (items.length === 0) {
            terminal.writeLine(selected_exchange_id + 'does not support OHLCV charts (no supported timeframes)');
            exchangeSelectActionMenu(selected_coin);
            return;
        }

        terminal.nl();
        terminal.writeLine('What timeframe?');

        term.singleColumnMenu(items, function (error, response) {
            exchangeOHLCVMenu(selected_coin, selected_exchange_id, items_ids[response.selectedIndex]);
        });

        return;

    }

    if (!do_not_create_progress_bar)
        createProgressBar(160, 'OHLCV', 1);

    try {

        progressBar.startItem('fetching OHLCV');

        let params = {};

        if (selected_exchange_id === 'bitfinex')
            params.sort = 1;

        let since = (Date.now() - (getTimeFrameSeconds(selected_time_frame) * 96 * 1000));

        await APISleep(selected_exchange_id);
        let ohlcv = await config.exchanges[selected_exchange_id].fetchOHLCV(selected_coin + '/' + _SELECTED_QUOTE, selected_time_frame, since, 96, params);

        progressBar.itemDone('fetching OHLCV');

        let ohlcv_time_start = ohlcv[0][0];
        let ohlcv_time_end = ohlcv[ohlcv.length - 1][0];

        let ohlcv_seconds = getTimeFrameSeconds(selected_time_frame);

        let series = ohlcv.map(x => x[4]);        // index = [ timestamp, open, high, low, close, volume ]

        if (series.length < 10) {
            terminal.clearLine();
            terminal.writeLine('There is not enough data to show a full chart');
            terminal.nl();
        } else {
            if(return_function_that_draws){
                return function(){
                    priceChart(terminal.niceTimeFormat(ohlcv_seconds * 96) + ' (Interval: ' + terminal.niceTimeFormat(ohlcv_seconds) + ') ' + selected_coin + ' / ' + _SELECTED_QUOTE + ' (' + config.exchanges[selected_exchange_id].describe()['name'] + ')', series, selected_coin, coinSymbolChar(_SELECTED_QUOTE), 8, ohlcv_time_start, ohlcv_time_end);
                };
            }else{
                priceChart(terminal.niceTimeFormat(ohlcv_seconds * 96) + ' (Interval: ' + terminal.niceTimeFormat(ohlcv_seconds) + ') ' + selected_coin + ' / ' + _SELECTED_QUOTE + ' (' + config.exchanges[selected_exchange_id].describe()['name'] + ')', series, selected_coin, coinSymbolChar(_SELECTED_QUOTE), 8, ohlcv_time_start, ohlcv_time_end);
            }
        }
    } catch (e) {
        console.log(e);
    }

    if (!do_not_create_progress_bar) {
        progressBar.stop();

        terminal.nl();

        exchangeSelectActionMenu(selected_coin);
    }
}

async function crossStockSection(){


    terminal.nl();
    terminal.showCentered('['+ _SELECTED_QUOTE+'] Cross-stock analysis '+getYmdHisDate(), '-');
    terminal.nl();

    await getPrices();

    let lowest = {};
    let highest = {};

    let columns = ['Coin'];

    for(let exchange_id in _PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE]){

        if(!_PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE].hasOwnProperty(exchange_id))
            continue;

        let coins = _PRICES_BY_EXCHANGES['BID'][_SELECTED_QUOTE][exchange_id];

        for (let coin in coins){

            if(!coins.hasOwnProperty(coin))
                continue;

            let price = coins[coin];

            // higher bid! somebody wants to buy at that much
            if(!highest.hasOwnProperty(coin) || price > highest[coin])
                highest[coin] = price;
        }
    }

    for (let exchange_id in _PRICES_BY_EXCHANGES['ASK'][_SELECTED_QUOTE]){

        if(!_PRICES_BY_EXCHANGES['ASK'][_SELECTED_QUOTE].hasOwnProperty(exchange_id))
            continue;

        let coins = _PRICES_BY_EXCHANGES['ASK'][_SELECTED_QUOTE][exchange_id];

        for (let coin in coins){

            if(!coins.hasOwnProperty(coin))
                continue;

            let price = coins[coin];

            // lower sale! somebody wants to sell at that much
            if(!lowest.hasOwnProperty(coin) || price < lowest[coin])
                lowest[coin] = price;
        }
    }

    let first_iteration = true;
    let data = [];

    for (let coin in lowest) {

        if(!lowest.hasOwnProperty(coin))
            continue;

        let price = lowest[coin];

        if(!price)
            continue;

        if (highest[coin]/price > 1.05) {

            let row = [coin];

            for(let exchange_id in config.exchanges) {

                if(!config.exchanges.hasOwnProperty(exchange_id))
                    continue;

                if (first_iteration) {
                    let exchange_details = config.exchanges[exchange_id].describe();

                    columns.push(exchange_details['name']);
                }

                let priceBid = getArrayItem(_PRICES_BY_EXCHANGES, 'BID', _SELECTED_QUOTE, exchange_id, coin);
                let priceAsk = getArrayItem(_PRICES_BY_EXCHANGES, 'ASK', _SELECTED_QUOTE, exchange_id, coin);

                if(!priceBid)
                    row.push('-');
                else
                    row.push(terminal.number_format(priceBid, 8) + ' / ' + terminal.number_format(priceAsk, 8) + ' / ' + terminal.number_format((priceBid/price*100)-100,1) + '%');
            }

            first_iteration = false;

            data.push(row);

        }

    }

    let t = new Table({
        borderStyle: 3,
        horizontalLine: true,
        rightPadding: 1,
        leftPadding: 1,
        align: 'right',
        width: ['10']

    });

    t.attrRange({row: [0, 1]}, {
        align: "center",
        color: "blue",
        bg: "black"
    });


    t.push(columns);

    for(let row_id in data){
        t.push(data[row_id]);
    }

    t.attrRange(
        {
            column: [1, columns.length],
            row: [1, data.length+2]
        },
        {align: "right"}
    );


    terminal.writeLine("" + t);


    /*
    drawTable($columns, $data);

    echo "\n";
    echo "\t1. Scan again\n";
    echo "\t2. Plan purchase\n";
    echo "\n";

    $option = intval(readline('What do you want to do? '));

    switch ($option){
        case 1:
            crossStockSection();
            return;
            break;

        case 2:

            break;
    }


    */

    mainSection();

}


async function crossCurrencySection(){

    let cross_currency_A = 'BTC';
    let cross_currency_B = 'ETH';

    await getPrices();

    terminal.nl();
    terminal.showCentered('Cross-currency analysis '+getYmdHisDate(), '-');
    terminal.nl();

    let available_exchanges = [];
    let common_coins = {};
    let A_B_ratios = {};
    let B_A_ratios = {};
    // now find what coins we have in common
    for(let exchange_id in _EXCHANGES_BY_QUOTES[cross_currency_A]){
        if(_EXCHANGES_BY_QUOTES[cross_currency_B][exchange_id]){
            // this exchange can be used
            available_exchanges.push(exchange_id);
            common_coins[exchange_id] = {};
        }
    }

    let columns = ['Coin', 'Exchange', 'Buy for', 'Sell for', 'Profit'];


    let t = new Table({
        borderStyle: 3,
        horizontalLine: true,
        rightPadding: 1,
        leftPadding: 1,
        align: 'right',
        width: ['10']

    });

    t.attrRange({row: [0, 1]}, {
        align: "center",
        color: "blue",
        bg: "black"
    });


    t.push(columns);

    t.attrRange(
        {
            column: [1, columns.length]
        },
        {align: "right"}
    );



    for(let i = 0; i < available_exchanges.length; i++) {
        let exchange_id = available_exchanges[i];

        let exchange_name = config.exchanges[exchange_id].describe()['name'];

        for(let coin in _PRICES_BY_EXCHANGES['BID'][cross_currency_A][exchange_id]){
            if(!_PRICES_BY_EXCHANGES['BID'][cross_currency_A][exchange_id].hasOwnProperty(coin))
                continue;

            if(_PRICES_BY_EXCHANGES['BID'][cross_currency_B][exchange_id].hasOwnProperty(coin)){
                common_coins[exchange_id][coin] = 1;

                // buy for BTC, sell for ETH then sell ETH for BTC
                let A_spent = _PRICES_BY_EXCHANGES['ASK'][cross_currency_A][exchange_id][coin];
                let B_bought = _PRICES_BY_EXCHANGES['BID'][cross_currency_B][exchange_id][coin];
                let B_for_A = B_bought * _PRICES_BY_EXCHANGES['BID'][cross_currency_A][exchange_id][cross_currency_B];

                let A_B_gain = (B_for_A/A_spent-1);
                if(A_B_gain > 0.001){
                    t.push([coin, exchange_name, cross_currency_A, cross_currency_B, terminal.number_format(A_B_gain*100, 3) + '%']);
                }


                // buy for ETH, sell for BTC then sell BTC for ETH
                let B_spent = _PRICES_BY_EXCHANGES['ASK'][cross_currency_B][exchange_id][coin];
                let A_bought = _PRICES_BY_EXCHANGES['BID'][cross_currency_A][exchange_id][coin];
                let A_for_B = A_bought / _PRICES_BY_EXCHANGES['ASK'][cross_currency_A][exchange_id][cross_currency_B];

                let B_A_gain = (A_for_B/B_spent-1);
                if(B_A_gain > 0.001){
                    t.push([coin, exchange_name, cross_currency_B, cross_currency_A, terminal.number_format(B_A_gain*100, 3) + '%']);
                }

                // did I make profit?

            }
        }


    }


    terminal.writeLine("" + t);


    /*
    drawTable($columns, $data);

    echo "\n";
    echo "\t1. Scan again\n";
    echo "\t2. Plan purchase\n";
    echo "\n";

    $option = intval(readline('What do you want to do? '));

    switch ($option){
        case 1:
            crossStockSection();
            return;
            break;

        case 2:

            break;
    }


    */

    mainSection();

}

async function exchangeSection(selected_coin, reload){

    if(selected_coin === ''){
        mainSection();
        return;
    }

    await getPricesAndBalances(reload);

    if(!selected_coin) {
        terminal.nl();
        terminal.nl();
        terminal.showCentered('['+ _SELECTED_QUOTE+'] Exchange '+getYmdHisDate(), '-');
        terminal.nl();

        exchangeSelectCoinMenu();
        return;
    }else{
        selected_coin = selected_coin.toUpperCase();
    }

    terminal.nl();

    if(!_PRICES_BY_COINS['BID'][_SELECTED_QUOTE].hasOwnProperty(selected_coin)){
        terminal.writeLine("Cannot find any stock for "+ selected_coin + "/" +_SELECTED_QUOTE);
        exchangeSelectCoinMenu();
        return;
    }

    let progress_bar_items = 2;

    createProgressBar(160, 'Fetching '+selected_coin+'/'+_SELECTED_QUOTE+'', progress_bar_items);

    progressBar.startItem('calculating');
    selected_coin = selected_coin.toUpperCase();

    let columns = ['Exchange', 'Change', 'Ask', 'Bid', 'Volume', 'Owned', 'Owned available', _SELECTED_QUOTE + ' available'];

    let columns_orders = ['Time', 'Exchange', 'Side','Symbol', 'ID', 'Type', 'Price', 'Cost', 'Amount', 'Filled'];

    // fetch tickers

    let data = [];
    let data_orders = [];

    let highest_volume = 0;
    let highest_volume_exchange_id = null;

    let promises = [];
    let promises_orders = [];

    _OPEN_ORDERS = {};

    for (let exchange_id in _PRICES_BY_COINS['BID'][_SELECTED_QUOTE][selected_coin]){

        if(!_PRICES_BY_COINS['BID'][_SELECTED_QUOTE][selected_coin].hasOwnProperty(exchange_id))
            continue;

        if(!config.exchanges[exchange_id].markets[selected_coin+'/'+_SELECTED_QUOTE]['active'])
            continue;

        // fetch tickers
        let exchange_details = config.exchanges[exchange_id].describe();

        progressBar.update({items: ++progress_bar_items});
        progressBar.startItem('fetching '+exchange_id+' ticker');

        let promise = (async () => {

            await APISleep(exchange_id);

            return await config.exchanges[exchange_id].fetch_ticker(selected_coin+'/'+_SELECTED_QUOTE);
        })();

        progressBar.update({items: ++progress_bar_items});
        progressBar.startItem('fetching '+exchange_id+' orders');


        let promise_orders = (async () => {

            await APISleep(exchange_id);

            return await config.exchanges[exchange_id].fetchOpenOrders(selected_coin+'/'+_SELECTED_QUOTE);
        })();

        promise.then(function(ticker){
            progressBar.itemDone('fetching '+exchange_id+' ticker');


            let quote_value = parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES, exchange_id, selected_coin, 'total'));
            let quote_free_value = parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES, exchange_id, selected_coin, 'free'));

            if(selected_coin !== _SELECTED_QUOTE) {
                quote_value *= parseFloat(getArrayItem(_PRICES_BY_EXCHANGES, 'BID', _SELECTED_QUOTE, exchange_id, selected_coin));
                quote_free_value *= parseFloat(getArrayItem(_PRICES_BY_EXCHANGES, 'BID', _SELECTED_QUOTE, exchange_id, selected_coin));
            }

            let volume = ticker['quoteVolume'];

            if(!volume)
                volume = ticker['baseVolume'] * parseFloat(getArrayItem(_PRICES_BY_EXCHANGES, 'BID', _SELECTED_QUOTE, exchange_id, selected_coin));

            if(volume > highest_volume){
                highest_volume_exchange_id = exchange_id;
                highest_volume = volume;
            }

            data.push([
                exchange_details['name'],
                terminal.number_format(ticker['change'],1)+"%",
                terminal.number_format(ticker['ask'],8)+" "+coinSymbolChar(_SELECTED_QUOTE),
                terminal.number_format(ticker['bid'],8)+" "+coinSymbolChar(_SELECTED_QUOTE),
                terminal.number_format(volume,8)+" "+coinSymbolChar(_SELECTED_QUOTE),
                quote_value ? terminal.number_format( parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES, exchange_id, selected_coin, 'total')),3)+' ('+terminal.number_format(quote_value, 3)+' '+coinSymbolChar(_SELECTED_QUOTE)+')' : '-',
                quote_value ? terminal.number_format( parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES, exchange_id, selected_coin, 'free')),3)+' ('+terminal.number_format(quote_free_value, 3)+' '+coinSymbolChar(_SELECTED_QUOTE)+')' : '-',
                terminal.number_format( parseFloat(getArrayItem(_BALANCES_BY_EXCHANGES, exchange_id, _SELECTED_QUOTE, 'free')), 3) + ' ' + coinSymbolChar(_SELECTED_QUOTE)
            ]);

        }).catch(function(err){
            progressBar.itemDone('fetching '+exchange_id+' ticker');
        });

        promise_orders.then(function(orders){

            progressBar.itemDone('fetching '+exchange_id+' orders');

            if(orders.length > 0) {

                for(let i = 0; i < orders.length; i++) {

                    if(!_OPEN_ORDERS.hasOwnProperty(orders[i]['symbol']))
                        _OPEN_ORDERS[orders[i]['symbol']] = {};

                    if(!_OPEN_ORDERS[orders[i]['symbol']].hasOwnProperty(exchange_id))
                        _OPEN_ORDERS[orders[i]['symbol']][exchange_id] = {};

                    _OPEN_ORDERS[orders[i]['symbol']][exchange_id][orders[i]['id']] = orders[i];


                    let market = config.exchanges[exchange_id].market(orders[i]['symbol']);

                    data_orders.push([
                        getYmdHisDate(orders[i]['timestamp']),
                        config.exchanges[exchange_id].describe()['name'],
                        orders[i]['side'].toUpperCase(),
                        orders[i]['symbol'],
                        orders[i]['id'],
                        orders[i]['type'].toUpperCase(),
                        terminal.number_format(orders[i]['price'],market.precision.price),
                        terminal.number_format(orders[i]['cost'],market.precision.price),
                        terminal.number_format(orders[i]['amount'],market.precision.amount),
                        terminal.number_format(orders[i]['filled'],market.precision.amount),
                    ]);


                }
            }


        }).catch(function(err){
            progressBar.itemDone('fetching '+exchange_id+' orders');
        });


        promises.push(promise);
        promises_orders.push(promise_orders);

    }

    for(let i = 0; i < promises.length; i++){
        try {
            await promises[i];
        }catch(e){
            terminal.nl();
            terminal.writeLine('Error fetching tickers');
            console.log(e);
            terminal.nl();
        }

        try {
            await promises_orders[i];
        }catch(e){
            terminal.nl();
            terminal.writeLine('Error fetching orders');
            console.log(e);
            terminal.nl();
        }
    }

    progressBar.itemDone('calculating');
    let ohlcv_promise = null;

    if(config.exchanges.hasOwnProperty(highest_volume_exchange_id) && config.exchanges[highest_volume_exchange_id].hasOwnProperty('hasFetchOHLCV')) {
        ohlcv_promise = exchangeOHLCVMenu(selected_coin, highest_volume_exchange_id, '15m', true, true, true);
    }

    let draw_ohlcv_function = null;

    if(ohlcv_promise) {
        draw_ohlcv_function = await ohlcv_promise;
    }

    let symbol_for_coinmarketcap = convertSymbolToCoinMarketCapSymbol(selected_coin);


    let coinmarketcap_ticker = _COINMARKETCAP_COINS[_SELECTED_CURRENCY+ '/' +_SELECTED_QUOTE][symbol_for_coinmarketcap];

    progressBar.update(1);
    progressBar.stop();

    if(coinmarketcap_ticker){

        terminal.nl();
        terminal.nl();
        terminal.showCentered('Coinmarketcap.com stats for '+coinmarketcap_ticker['name'], '-');
        terminal.nl();
        terminal.showCentered('Price: '+terminal.number_format(coinmarketcap_ticker['price_currency'],3)+' '+_SELECTED_CURRENCY);
        terminal.showCentered('Price '+_SELECTED_QUOTE+': '+terminal.number_format(coinmarketcap_ticker['price'],8)+' '+coinSymbolChar(_SELECTED_QUOTE));
        terminal.showCentered(_SELECTED_CURRENCY+' price change 24 hours: '+terminal.number_format(coinmarketcap_ticker['percent_change_24h'],2)+'%');
        terminal.showCentered('Market cap: '+terminal.number_format(coinmarketcap_ticker['market_cap_currency'],0)+' '+_SELECTED_CURRENCY+ ' (rank #'+terminal.number_format(coinmarketcap_ticker['rank'],0)+')');
        terminal.showCentered('24 hours volume: '+terminal.number_format(coinmarketcap_ticker['quoteVolume'],0)+' '+_SELECTED_CURRENCY);
        terminal.nl();
        terminal.showCentered('https://coinmarketcap.com/currencies/'+coinmarketcap_ticker['id']+'/');
        terminal.nl();

    }

    if(draw_ohlcv_function)
        draw_ohlcv_function();

    let t = new Table({
        borderStyle: 3,
        horizontalLine: true,
        rightPadding: 1,
        leftPadding: 1,
        align: 'right'

    });

    t.attrRange({row: [0, 1]}, {
        align: "center",
        color: "blue",
        bg: "black"
    });


    t.push(columns);


    data.sort(function(a, b) {
        if (a[0] < b[0])
            return -1;

        if ( a[0] > b[0])
            return 1;

        return 0;
    });


    for(let row_id in data){
        t.push(data[row_id]);
    }

    t.attrRange(
        {
            column: [1, columns.length],
            row: [1, data.length+2]
        },
        {align: "right"}
    );

    terminal.nl();
    terminal.showCentered('Showing rates for '+ selected_coin+'/'+_SELECTED_QUOTE);

    terminal.writeLine("\n" + t);

    terminal.nl();

    t = new Table({
        borderStyle: 3,
        horizontalLine: true,
        rightPadding: 1,
        leftPadding: 1,
        align: 'right'
    });

    t.attrRange({row: [0, 1]}, {
        align: "center",
        color: "blue",
        bg: "black"
    });

    t.push(columns_orders);



    data_orders.sort(function(a, b) {
        // sort by exchange first (ASC)
        if (a[1] < b[1])
            return -1;

        if ( a[1] > b[1])
            return 1;

        // if we have orders from same exchange then sort by timestamp (DESC)
        if (a[0] > b[0])
            return -1;

        if ( a[0] < b[0])
            return 1;

        return 0;
    });


    for(let row_id in data_orders){
        t.push(data_orders[row_id]);
    }

    t.attrRange(
        {
            column: [1, columns_orders.length],
            row: [1, data_orders.length+2]
        },
        {align: "right"}
    );

    if(data_orders.length > 0) {
        terminal.nl();
        terminal.showCentered('Open orders for ' + selected_coin + '/' + _SELECTED_QUOTE);

        terminal.writeLine("\n" + t);
    }else{
        terminal.nl();
        terminal.showCentered('No Open orders for ' + selected_coin + '/' + _SELECTED_QUOTE);
    }

    exchangeSelectActionMenu(selected_coin);

}


async function changeQuoteSection(new_quote){

    await getPrices(false);

    if(!new_quote) {
        changeQuoteSectionMenu();
        return;
    }

    new_quote = new_quote.toUpperCase();

    if(!_EXCHANGES_BY_QUOTES[new_quote]){
        terminal.writeLine("Quote "+new_quote+" is not supported on any of active stocks");
        changeQuoteSection();
        return;
    }else{
        _SELECTED_QUOTE = new_quote;
        terminal.nl();
        terminal.writeLine("SUCCESS: Quote changed to "+new_quote);
        terminal.nl();
    }

    mainSection();
    return;

}

let initFunction = function() {


    if(command_line_options.quote) {
        _SELECTED_QUOTE = command_line_options.quote;
    }

    if(command_line_options.currency) {
        _SELECTED_CURRENCY = command_line_options.currency;
    }

    if(command_line_options.balance){
        balanceSection();
        return;
    }

    if(command_line_options.exchange){
        exchangeSection(command_line_options.exchange);
        return;
    }

    if(command_line_options.btcusd){
        bitcoinPriceChart();
        return;
    }

    if(command_line_options.crossstock){
        crossStockSection();
        return;
    }

    if(command_line_options.crosscurrency){
        crossCurrencySection();
        return;
    }

    mainSection();

};

config.loadConfig(initFunction, null, command_line_options.password);

