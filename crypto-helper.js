var crypto = require('crypto');

function CryptoHelper(secret, iv, algorithm){
    if(!secret || typeof secret !== 'string' || secret.length < 1){
        secret = 'defaultSecret';
        throw new Error('CryptoHelper: secret must be a non-0-length string');
    }

    algorithm = algorithm || 'aes-256-ctr';

    if(typeof algorithm !== 'string'){
        throw new Error('CryptoHelper: algorithm must be a string, see https://nodejs.org/api/crypto.html for details');
    }

    this.algorithm = algorithm;
    this.iv = iv;
    this.secret = secret;

    while(this.secret.length < 32){
        this.secret += this.secret;
    }

    this.secret = this.secret.substr(0,32);

    this.changeIV = function(iv){

        if(typeof iv !== 'string'){
            throw new Error('CryptoHelper: IV must be a string, see https://nodejs.org/api/crypto.html for details');
        }

        this.iv = iv;
    };

    this.encrypt = function encrypt(value){
        if(value == null){
            throw new Error('value must not be null or undefined');
        }

        value = String(value);

        var cipher = crypto.createCipheriv(this.algorithm, this.secret, this.iv);
        return cipher.update(value, 'utf8', 'hex') + cipher.final('hex');
    };

    this.decrypt = function decrypt(value){
        if(value == null){
            throw new Error('value must not be null or undefined');
        }

        value = String(value);

        var decipher = crypto.createDecipheriv(this.algorithm, this.secret, this.iv);
        return decipher.update(value, 'hex', 'utf8') + decipher.final('utf8');
    };
}

module.exports = CryptoHelper;
