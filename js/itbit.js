'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { ExchangeError, AuthenticationError } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class itbit extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'itbit',
            'name': 'itBit',
            'countries': [ 'US' ],
            'rateLimit': 2000,
            'version': 'v1',
            'has': {
                'CORS': true,
                'createMarketOrder': false,
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/27822159-66153620-60ad-11e7-89e7-005f6d7f3de0.jpg',
                'api': 'https://api.itbit.com',
                'www': 'https://www.itbit.com',
                'doc': [
                    'https://api.itbit.com/docs',
                    'https://www.itbit.com/api',
                ],
            },
            'api': {
                'public': {
                    'get': [
                        'markets/{symbol}/ticker',
                        'markets/{symbol}/order_book',
                        'markets/{symbol}/trades',
                    ],
                },
                'private': {
                    'get': [
                        'wallets',
                        'wallets/{walletId}',
                        'wallets/{walletId}/balances/{currencyCode}',
                        'wallets/{walletId}/funding_history',
                        'wallets/{walletId}/trades',
                        'wallets/{walletId}/orders',
                        'wallets/{walletId}/orders/{id}',
                    ],
                    'post': [
                        'wallet_transfers',
                        'wallets',
                        'wallets/{walletId}/cryptocurrency_deposits',
                        'wallets/{walletId}/cryptocurrency_withdrawals',
                        'wallets/{walletId}/orders',
                        'wire_withdrawal',
                    ],
                    'delete': [
                        'wallets/{walletId}/orders/{id}',
                    ],
                },
            },
            'markets': {
                'BTC/USD': { 'id': 'XBTUSD', 'symbol': 'BTC/USD', 'base': 'BTC', 'quote': 'USD' },
                'BTC/SGD': { 'id': 'XBTSGD', 'symbol': 'BTC/SGD', 'base': 'BTC', 'quote': 'SGD' },
                'BTC/EUR': { 'id': 'XBTEUR', 'symbol': 'BTC/EUR', 'base': 'BTC', 'quote': 'EUR' },
            },
            'fees': {
                'trading': {
                    'maker': 0,
                    'taker': 0.2 / 100,
                },
            },
            'commonCurrencies': {
                'XBT': 'BTC',
                'USD': 'USD',
                'SGD': 'SGD',
                'EUR': 'EUR',
                'ETH': 'ETH',
            },
        });
    }

    async fetchOrderBook (symbol, limit = undefined, params = {}) {
        let orderbook = await this.publicGetMarketsSymbolOrderBook (this.extend ({
            'symbol': this.marketId (symbol),
        }, params));
        return this.parseOrderBook (orderbook);
    }

    async fetchTicker (symbol, params = {}) {
        let ticker = await this.publicGetMarketsSymbolTicker (this.extend ({
            'symbol': this.marketId (symbol),
        }, params));
        let serverTimeUTC = this.safeString (ticker, 'serverTimeUTC');
        if (!serverTimeUTC)
            throw new ExchangeError (this.id + ' fetchTicker returned a bad response: ' + this.json (ticker));
        let timestamp = this.parse8601 (serverTimeUTC);
        let vwap = this.safeFloat (ticker, 'vwap24h');
        let baseVolume = this.safeFloat (ticker, 'volume24h');
        let quoteVolume = undefined;
        if (baseVolume !== undefined && vwap !== undefined)
            quoteVolume = baseVolume * vwap;
        let last = this.safeFloat (ticker, 'lastPrice');
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'high24h'),
            'low': this.safeFloat (ticker, 'low24h'),
            'bid': this.safeFloat (ticker, 'bid'),
            'bidVolume': undefined,
            'ask': this.safeFloat (ticker, 'ask'),
            'askVolume': undefined,
            'vwap': vwap,
            'open': this.safeFloat (ticker, 'openToday'),
            'close': last,
            'last': last,
            'previousClose': undefined,
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': baseVolume,
            'quoteVolume': quoteVolume,
            'info': ticker,
        };
    }

    parseTrade (trade, market) {
        let timestamp = this.parse8601 (trade['timestamp']);
        if ('matchNumber' in trade) {
            // then this is a public request response, ie, market data
            let id = trade['matchNumber'].toString ();
            return {
                'info': trade,
                'timestamp': timestamp,
                'datetime': this.iso8601 (timestamp),
                'symbol': market['symbol'],
                'id': id,
                'order': id,
                'type': undefined,
                'side': undefined,
                'price': this.safeFloat (trade, 'price'),
                'amount': this.safeFloat (trade, 'amount'),
            };
        } else {
            // this is a private request response, ie, MY trades
            // note on fee from itbit:
            // + **commissionPaid** `string` - *net trade fee paid after using any available rebate balance*
            let fee = {
                'cost': this.safeFloat (trade, 'commissionPaid'),
                'currency': this.safeString (trade, 'commissionCurrency'),
            };
            return {
                'info': trade,
                'timestamp': timestamp,
                'datetime': this.iso8601 (timestamp),
                'symbol': this.marketsById[this.safeString (trade, 'instrument')].symbol,
                'id': this.safeString (trade, 'executionId'),
                'order': this.safeString (trade, 'orderId'),
                'type': undefined,
                'side': this.safeString (trade, 'direction'),
                'price': this.safeFloat (trade, 'rate'),
                'amount': this.safeFloat (trade, 'currency1Amount'),
                'fee': fee,
            };
        }
    }

    async fetchMyTrades (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        const walletId = this.safeString (params, 'walletId');
        if (walletId === undefined) {
            throw new ExchangeError (this.id + ' fetchMyTrades requires a walletId parameter');
        }
        await this.loadMarkets ();
        const request = {
            'walletId': walletId,
        };
        if (since !== undefined) {
            request['rangeStart'] = this.ymdhms (since, 'T');
        }
        if (limit !== undefined) {
            request['perPage'] = limit; // default 50, max 50
        }
        const response = await this.privateGetWalletsWalletIdTrades (this.extend (request, params));
        const trades = this.safeValue (response, 'tradingHistory', []);
        let market = undefined;
        if (symbol !== undefined) {
            market = this.market (symbol);
        }
        return this.parseTrades (trades, market, since, limit);
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        let market = this.market (symbol);
        let response = await this.publicGetMarketsSymbolTrades (this.extend ({
            'symbol': market['id'],
        }, params));
        return this.parseTrades (response['recentTrades'], market, since, limit);
    }

    async fetchBalance (params = {}) {
        const response = await this.fetchWallets (params);
        const balances = response[0]['balances'];
        const result = { 'info': response };
        for (let i = 0; i < balances.length; i++) {
            const balance = balances[i];
            const currencyId = this.safeString (balance, 'currency');
            const code = this.commonCurrencyCode (currencyId);
            let account = {
                'free': this.safeFloat (balance, 'availableBalance'),
                'used': 0.0,
                'total': this.safeFloat (balance, 'totalBalance'),
            };
            account['used'] = account['total'] - account['free'];
            result[code] = account;
        }
        return this.parseBalance (result);
    }

    async fetchWallets (params = {}) {
        if (!this.uid)
            throw new AuthenticationError (this.id + ' fetchWallets requires uid API credential');
        let request = {
            'userId': this.uid,
        };
        return this.privateGetWallets (this.extend (request, params));
    }

    async fetchWallet (walletId, params = {}) {
        let wallet = {
            'walletId': walletId,
        };
        return this.privateGetWalletsWalletId (this.extend (wallet, params));
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        return this.fetchOrders (symbol, since, limit, this.extend ({
            'status': 'open',
        }, params));
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        return this.fetchOrders (symbol, since, limit, this.extend ({
            'status': 'filled',
        }, params));
    }

    async fetchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        let walletIdInParams = ('walletId' in params);
        if (!walletIdInParams)
            throw new ExchangeError (this.id + ' fetchOrders requires a walletId parameter');
        let walletId = params['walletId'];
        let response = await this.privateGetWalletsWalletIdOrders (this.extend ({
            'walletId': walletId,
        }, params));
        let orders = this.parseOrders (response, undefined, since, limit);
        return orders;
    }

    parseOrder (order, market = undefined) {
        let side = order['side'];
        let type = order['type'];
        let symbol = this.markets_by_id[order['instrument']]['symbol'];
        let timestamp = this.parse8601 (order['createdTime']);
        let amount = this.safeFloat (order, 'amount');
        let filled = this.safeFloat (order, 'amountFilled');
        let remaining = amount - filled;
        let fee = undefined;
        let price = this.safeFloat (order, 'price');
        let cost = price * this.safeFloat (order, 'volumeWeightedAveragePrice');
        return {
            'id': order['id'],
            'info': order,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'lastTradeTimestamp': undefined,
            'status': order['status'],
            'symbol': symbol,
            'type': type,
            'side': side,
            'price': price,
            'cost': cost,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'fee': fee,
            // 'trades': this.parseTrades (order['trades'], market),
        };
    }

    nonce () {
        return this.milliseconds ();
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        if (type === 'market')
            throw new ExchangeError (this.id + ' allows limit orders only');
        let walletIdInParams = ('walletId' in params);
        if (!walletIdInParams)
            throw new ExchangeError (this.id + ' createOrder requires a walletId parameter');
        amount = amount.toString ();
        price = price.toString ();
        let market = this.market (symbol);
        let order = {
            'side': side,
            'type': type,
            'currency': market['id'].replace (market['quote'], ''),
            'amount': amount,
            'display': amount,
            'price': price,
            'instrument': market['id'],
        };
        let response = await this.privatePostWalletsWalletIdOrders (this.extend (order, params));
        return {
            'info': response,
            'id': response['id'],
        };
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        const walletIdInParams = ('walletId' in params);
        if (!walletIdInParams) {
            throw new ExchangeError (this.id + ' fetchOrder requires a walletId parameter');
        }
        const request = { 'id': id };
        const response = await this.privateGetWalletsWalletIdOrdersId (this.extend (request, params));
        return this.parseOrder (response);
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        let walletIdInParams = ('walletId' in params);
        if (!walletIdInParams)
            throw new ExchangeError (this.id + ' cancelOrder requires a walletId parameter');
        return await this.privateDeleteWalletsWalletIdOrdersId (this.extend ({
            'id': id,
        }, params));
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/' + this.version + '/' + this.implodeParams (path, params);
        let query = this.omit (params, this.extractParams (path));
        if (method === 'GET' && Object.keys (query).length)
            url += '?' + this.urlencode (query);
        if (method === 'POST' && Object.keys (query).length)
            body = this.json (query);
        else
            body = '';
        if (api === 'private') {
            this.checkRequiredCredentials ();
            let nonce = this.nonce ().toString ();
            let timestamp = nonce;
            let auth = [ method, url, body, nonce, timestamp ];
            let message = nonce + this.json (auth).replace ('\\/', '/');
            let hash = this.hash (this.encode (message), 'sha256', 'binary');
            let binaryUrl = this.stringToBinary (this.encode (url));
            let binhash = this.binaryConcat (binaryUrl, hash);
            let signature = this.hmac (binhash, this.encode (this.secret), 'sha512', 'base64');
            headers = {
                'Authorization': this.apiKey + ':' + signature,
                'Content-Type': 'application/json',
                'X-Auth-Timestamp': timestamp,
                'X-Auth-Nonce': nonce,
            };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    async request (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let response = await this.fetch2 (path, api, method, params, headers, body);
        if ('code' in response)
            throw new ExchangeError (this.id + ' ' + this.json (response));
        return response;
    }
};
