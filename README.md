# ccxt-trading-cp
Console Cryptocoin Trading CP based on CCXT

This tool provides simple UI wrapper around some functionality from an amazing [CCXT library](https://github.com/ccxt/ccxt/)

## What can it do?

This tool provides console UI to:

* show balances
* fetch info about coins (price, volume, etc.)
* place orders (BUY, SELL)
* cancel open orders
* give overview about portfolio on various exchanges
* show possible profit from buying/selling on different exchanges
* show possible profit from buying/selling with different bases (e.g. XRP/BTC then XRP/ETH then ETH/BTC)

## Disclaimer

This tool is published with 0 liability. By using it, you accept the possibility that an order will be placed incorrectly, that you will sell what you didnt mean to sell and even that you may lose money by withdrawing into somebody else's or non-existing wallet.

That being said, I hope this will not happen. I made this tool for myself and I am glad to share it, but I reject any liability whatsoever for wrong API commands being sent. I recommend to set IP whitelist and disable API withdrawal until you read the whole code of ccxt, this package and all the 100+ packages these 2 reference and require. Never trust somebody else with your API keys/secret.

## Getting Started

Installation is straigh forward and requires getting copy of ccxt-trading-cp, installing modules it depends on and modifying config.json file

### Prerequisites

You will need Nodejs 7.6+ and NPM.

### Installing

The easiest way is from [ccxt-trading-cp in **NPM**](http://npmjs.com/package/ccxt-trading-cp)

```
npm install ccxt-trading-cp
```

After that edit *config.default.json* file and save it as config.json file in project root folder.

```
mv config.default.json config.json && nano config.json
```

This is a config JSON file where you have to provide API keys and secrets. Place all these into exchanges_unencrypted array, every item is an object which has:
* exchange - id of exchange from ccxt package
* apiKey - your exchange API key
* apiSecret - your exchange API secret
* [inactive] - if set and equal to 1, then exchange is not used in scripts (useful if you dont want to delete it, just inactivate it for some time)

```
{
  "exchanges_unencrypted": [
    {
      "exchange": "binance",
      "apiKey": "XXXXXXXXXXXXXXXXXXXXXXXXX",
      "apiSecret": "XXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    },
    {
      "exchange": "bittrex",
      "inactive": 1,
      "apiKey": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX",
      "apiSecret": "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
    },
  ],
  "exchange_for_btc_usd": "okcoinusd"
}

```

There is also *exchange_for_btc_usd* property which is used only for fetching BTC/USD OCHLV chart and USD price of BTC.

Every time you add new exchange, insert it inside exchanges_unencrypted array. ccxt-trading-cp has ability to encrypt API key/secret credentials, but this can be done only from inside the app. First time you must enter it in plaintext and then select the option to encrypt config file from within the main menu.

**Never modify exchanges_encrypted property**.

### Command line args

I suggest making file executable and running it as:

```
./tradingcp.js [ARGUMENTS]
```

Note that exchange option is taken as default, so you can use 

```
./tradingcp.js [ARGUMENTS] ETH
```

to show ETH/BTC exchange section.

#### Options

* *-q, --quote QUOTE* - This defines quote for markets (we trade in this currency) [Default: BTC]
* *-b, --balance* - Go to balance overview (show how much of what I have on all exchanges and its BTC value)
* *--crossstock* - Go to cross-stock analysis (can I buy coin on one exchange and sell on another one?)                        
* *--crosscurrency* - Go to cross-currency analysis (can I buy coin for BTC, then sell it for ETH then sell ETH for BTC and make profit?)
* *--btcusd* - Show BTC / USD price
* *-p, --password* PASSWORD - Prefill config password in command line
* *-e, --exchange* COIN - Load exchange details about given coin
  
## Tested exchanges

I myself am using the following exchanges without any issues

* Bitfinex
* Binance
* Bibox
* Cryptopia
* OKEX
* Kucoin
* Poloniex

in theory it should work with many others, but I have not tested them. Some exchanges are limited in API possibilities, so they are just not suitable for this CP.

### CCXT exchange module requirements

In order for exchange to work, CCXT exchange module must support:

* *fetchTickers()*
* *fetchOpenOrders()*
* *createOrder()*
* *cancelOrder()*
* *fetchBalance()*

Optionally *fetchOCHLV()* function is useful to show some simple charts.


## Contributing

for now I have no special contribution rules, if you have any interesting changes, feel free to open issue or submit pull request.

## Versioning

I pretty much make up version numbers as I want to for now.

## Authors

* **michnovka** - thats me

## License

This project is licensed under the MIT License - see the [LICENSE.md](LICENSE.md) file for details

## Acknowledgments

* All hail [ccxt](https://github.com/ccxt/ccxt/)
* Very useful toolset for terminal interaction [terminal-kit](https://github.com/cronvel/terminal-kit)
* Nice toolset for working with command line arguments [command-line-args](https://github.com/75lb/command-line-args)
* everybody else whose code I include in package.json
