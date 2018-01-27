let ccxt = require('ccxt');
let termkit = require( 'terminal-kit' ) ;
let term = termkit.terminal ;
let fs = require('fs');
let path = require('path');

let generateHash = require('random-hash').generateHash;

const magic_hash_plain = 'ThisLibIsAwesome0987654321';

function loadConfigExecute(password, config_object){

    try {

        module.exports.exchanges = {};
        module.exports.exchanges_inactive = {};
        
        if(password && config_object.hasOwnProperty('exchanges_encrypted') && config_object.exchanges_encrypted && config_object.exchanges_encrypted.length > 0) {
            // process unencrypted exchanges
            let Crypth = require('./crypto-helper.js'),
                crypth = new Crypth(password, config_object['magic_hash_do_not_modify_iv']);

            try {
                if (crypth.decrypt(config_object['magic_hash_do_not_modify']) !== magic_hash_plain) {
                    return false;
                }
            }catch (e){
                return false;
            }

            if(config_object.exchanges_encrypted.length > 0){
                for(let i = 0; i < config_object.exchanges_encrypted.length; i++){
                    let exchange_id = config_object.exchanges_encrypted[i].exchange;

                    let exchange = new ccxt[exchange_id]({verbose: config_object.exchanges_encrypted[i].debug ? 1 : 0});

                    crypth.changeIV(config_object.exchanges_encrypted[i].iv);
                    exchange.apiKey = crypth.decrypt(config_object.exchanges_encrypted[i].apiKey);
                    exchange.secret = crypth.decrypt(config_object.exchanges_encrypted[i].apiSecret);

                    if(config_object.exchanges_encrypted[i].inactive)
                        module.exports.exchanges_inactive[exchange_id] = exchange;
                    else
                        module.exports.exchanges[exchange_id] = exchange;
                }
            }

        }

        if(config_object.hasOwnProperty('exchanges_unencrypted') && config_object.exchanges_unencrypted && config_object.exchanges_unencrypted.length > 0){

            if(config_object.exchanges_unencrypted.length > 0){
                for(let i = 0; i < config_object.exchanges_unencrypted.length; i++){
                    let exchange_id = config_object.exchanges_unencrypted[i].exchange;

                    let exchange = new ccxt[exchange_id]({verbose: config_object.exchanges_encrypted[i].debug ? 1 : 0});

                    exchange.apiKey = config_object.exchanges_unencrypted[i].apiKey;
                    exchange.secret = config_object.exchanges_unencrypted[i].apiSecret;

                    if(config_object.exchanges_unencrypted[i].inactive)
                        module.exports.exchanges_inactive[exchange_id] = exchange;
                    else
                        module.exports.exchanges[exchange_id] = exchange;
                }
            }
        }

        let default_exchange_for_fiat = 'okcoinusd';

        if(config_object.hasOwnProperty('exchange_for_fiat'))
            default_exchange_for_fiat = config_object.exchange_for_fiat;

        module.exports.exchange_for_fiat = new ccxt[default_exchange_for_fiat]();

        module.exports.coinmarketcap = new ccxt.coinmarketcap();

    }catch (e){
        // invalid config file
        console.log(e);
        process.exit();
    }

    return true;

}


module.exports.loadConfig = function(callback, config_object = undefined, password = undefined){

    try {


        if(!config_object) {
            let config_file = fs.readFileSync(path.join(__dirname, 'config.json'),{ encoding: 'utf8' });

            config_object = JSON.parse(config_file);
        }

        if(config_object.hasOwnProperty('magic_hash_do_not_modify') && config_object.magic_hash_do_not_modify) {
            // we have to prompt for password

            if(password){
                if(!loadConfigExecute(password, config_object)){
                    console.log('\nInvalid password\n');
                    module.exports.loadConfig(callback, config_object);
                }else{
                    callback();
                }

            }else{
                term('\n');
                term('Please enter your password: ');

                term.inputField(
                    function (error, input) {
                        if (input) {
                            if (!loadConfigExecute(input, config_object)) {
                                console.log('\nInvalid password\n');
                                module.exports.loadConfig(callback, config_object);
                            } else {
                                callback();
                            }
                        } else {
                            console.log('invalid input', error, input);
                            module.exports.loadConfig(callback, config_object);
                        }
                    }
                );
            }

        }else{
            if(!loadConfigExecute(null, config_object)){
                console.log('\nUnknown error\n');
                process.exit();
            }else{
                callback();
            }
        }

    }catch (e){
        // invalid config file
        console.log(e);
        process.exit();
    }

};

function generateIV(){

    return generateHash({ length: 16 }); // 'KLgF'
}


function getExchangeJSONObject(exchange_object, password, inactive){

    let exchange_array_item = {exchange: exchange_object.describe()['id'], inactive: 0};
    if(password){
        let Crypth = require('./crypto-helper'),
            crypth = new Crypth(password);

        exchange_array_item.iv = generateIV();
        crypth.changeIV(exchange_array_item.iv);

        exchange_array_item.apiKey = crypth.encrypt(exchange_object.apiKey);
        exchange_array_item.apiSecret = crypth.encrypt(exchange_object.secret);

    }else {
        exchange_array_item.apiKey = exchange_object.apiKey;
        exchange_array_item.apiSecret = exchange_object.secret;
    }
    exchange_array_item.inactive = inactive ? 1 : 0;
    exchange_array_item.debug = exchange_object.verbose ? 1 : 0;

    return exchange_array_item;
}

module.exports.saveConfig = function(password){
   let json_object = {
       exchange_for_fiat: module.exports.exchange_for_fiat.describe()['id']
   };

   let exchanges_json_encoded = [];

   for(let exchange_id in module.exports.exchanges){

       if(!module.exports.exchanges.hasOwnProperty(exchange_id))
           continue;

       exchanges_json_encoded.push(getExchangeJSONObject(module.exports.exchanges[exchange_id], password, 0));
   }

   for(let exchange_id in module.exports.exchanges_inactive){

       if(!module.exports.exchanges_inactive.hasOwnProperty(exchange_id))
           continue;

       exchanges_json_encoded.push(getExchangeJSONObject(module.exports.exchanges_inactive[exchange_id], password, 1));
   }

   if(password){

       json_object['magic_hash_do_not_modify_iv'] = generateIV();

       let Crypth = require('./crypto-helper'),
           crypth = new Crypth(password, json_object['magic_hash_do_not_modify_iv']);

       json_object['magic_hash_do_not_modify'] = crypth.encrypt(magic_hash_plain);
       json_object.exchanges_encrypted = exchanges_json_encoded;
   }else{
       json_object.exchanges_unencrypted = exchanges_json_encoded;
   }

   //console.log(JSON.stringify(json_object, null, 4));

   fs.writeFileSync(path.join(__dirname, 'config.json'), JSON.stringify(json_object, null, 4),{ encoding: 'utf8' });


};