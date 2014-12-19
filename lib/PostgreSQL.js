/**
 * Created by mschwartz on 12/15/14.
 */

/*global java, require, exports, sync */

var {Thread} = require('Threads'),
    {DriverManager, Connection, PreparedStatement, ResultSet, Statement, Types} = java.sql,
    // cache these types for speed:
    {BIT, BOOLEAN} = Types,
    {TINYINT, BIGINT, SMALLINT, INTEGER} = Types,
    {REAL, FLOAT, DOUBLE, DECIMAL, NUMERIC} = Types,
    {VARBINARY, BINARY, LONGVARBINARY, LONGVARCHAR, CHAR, VARCHAR, CLOB, OTHER} = Types,
    {DATE, TIME, TIMESTAMP} = Types,
    {NULL} = Types;
;

/** @private */
function isArray( o ) {
    return toString.apply(o) === '[object Array]';
}

/** @private */
function addslashes( str ) {
    return (str + '').replace(/([\\"'])/g, "\\$1").replace(/\0/g, "\\0");
}
/** @private */
function decodeByteArray( bytes ) {
    if ( !bytes ) {
        return bytes;
    }
    return String(new java.lang.String(bytes));
}

// implementation of connection pool
// quite simple and just a few lines of JavaScript
// TODO support pooling for multiple database connection types/URIs

var pool = [];

/** @private */
var getConnection = sync(function ( url ) {
    if ( pool.length ) {
        return pool.pop();
    }
    else {
        java.lang.Class.forName('org.postgresql.Driver');
        var conn = java.sql.DriverManager.getConnection(url);
        //conn.setAutoCommit(false);
        return conn;
    }
}, pool);

/** @private */
var releaseConnection = sync(function ( conn ) {
    pool.push(conn);
}, pool);

/**
 * @private
 *
 * These config options to the constructor are handled specifically
 * anything else is appended to the URI string (see constructor doc)
 */
var knownConfigOptions = [
    'user',
    'password',
    'database',
    'host',
    'port'
];

function PosgreSQL( config ) {
    if ( !config || config.user === undefined || config.password === undefined || config.database === undefined ) {
        throw new Error('PosgreSQL constructor: invalid configuration');
    }

    var url = 'jdbc:postgresql://';
    url += config.host || 'localhost' + ':';
    url += config.port || 5432 + '/';
    url += config.database;
    url += '?user=' + config.user + '&password=' + config.password;
    decaf.each(config, function ( value, key ) {
        if ( knownConfigOptions.indexOf(key) === -1 ) {
            url += '&' + key + '=' + value;
        }
    });
    this.url = url;
}
PosgreSQL.quote = function ( s ) {
    return Connection.nativeSQL(s);
};

decaf.extend(PosgreSQL.prototype, {
    /** @private */
    getConnection     : function () {
        var me = Thread.currentThread();
        if ( !me.SQL ) {
            me.SQL = getConnection(this.url);
            if ( !me.handlerInstalled ) {
                me.on('endRequest', this.releaseConnection);
                me.handlerInstalled = true;
            }
        }
        // me.SQL = me.SQL || getConnection(this.url, this.encoding);
        return me.SQL;
    },
    /** @private */
    releaseConnection : function () {
        var me = Thread.currentThread();
        if ( me.SQL ) {
            releaseConnection(me.SQL);
            delete me.SQL;
        }
    },
    /**
     * @method destroy
     * @return {void}
     */
    destroy           : function () {
        // releaseConnection(this.conn);
    },
    /**
     * Issue a read query and return result as an array of objects
     *
     * @method getDataRows
     * @param query
     * @return {Array} array of objects
     */
    getDataRows       : function ( query ) {
        query = isArray(query) ? query.join('\n') : query;
        var connection = this.getConnection();
        connection.setReadOnly(true);
        var statement = connection.createStatement(),
            resultSet = statement.executeQuery(query),
            metaData = resultSet.getMetaData(),
            columns = metaData.getColumnCount(),
            types = [],
            names = [],
            i,
            bytes;

        for ( i = 1; i <= columns; i++ ) {
            types[ i ] = metaData.getColumnType(i);
            names[ i ] = metaData.getColumnLabel(i);
        }

        var result = [];
        while ( resultSet.next() ) {
            var row = {};
            for ( i = 1; i <= columns; i++ ) {
                switch ( types[ i ] ) {
                    case BIT:
                    case BOOLEAN:
                        row[ names[ i ] ] = Boolean(resultSet.getBoolean(i));
                        break;
                    case TINYINT:
                    case BIGINT:
                    case SMALLINT:
                    case INTEGER:
                        row[ names[ i ] ] = Number(resultSet.getLong(i));
                        break;
                    case REAL:
                    case FLOAT:
                    case DOUBLE:
                    case DECIMAL:
                    case NUMERIC:
                        row[ names[ i ] ] = Number(resultSet.getDouble(i));
                        break;
                    case VARBINARY:
                    case BINARY:
                    case LONGVARBINARY:
                        row[ names[ i ] ] = resultSet.getBytes(i);
                        break;
                    case LONGVARCHAR:
                    case CHAR:
                    case VARCHAR:
                    case CLOB:
                    case OTHER:
                        row[ names[ i ] ] = decodeByteArray(resultSet.getBytes(i));
                        break;
                    case DATE:
                    case TIME:
                    case TIMESTAMP:
                        row[ names[ i ] ] = resultSet.getInt(i); // getTimestamp(i);
                        break;
                    case NULL:
                        row[ names[ i ] ] = null;
                        break;
                    default:
                        console.log(types[ i ]);
                        row[ names[ i ] ] = String(resultSet.getString(i));
                        break;
                }
            }
            result.push(row);
        }
        try {
            statement.close();
            resultSet.close();
        }
        catch ( e ) {

        }
        this.releaseConnection(connection);
        return result;
    },
    /**
     * Issue a read query and return the first/only row returned as an object.
     *
     * @method getDataRow
     * @param query
     * @return {*}
     */
    getDataRow        : function ( query ) {
        var rows = this.getDataRows(query);
        return rows[ 0 ];
    },
    /**
     * Issue an update query and return the number of rows in the database changed.
     *
     * @method update
     * @param query
     * @return {*}
     */
    update            : function ( query ) {
        query = isArray(query) ? query.join('\n') : query;
        console.dir(query);
        var connection = this.getConnection();
        connection.setReadOnly(false);
        var statement = connection.createStatement(),
            result;

        try {
            result = statement.executeUpdate(query);
            result = statement.getUpdateCount();
        }
        catch (e) {
            e.query = query;
            throw e;
        }
        finally {
            try {
                statement.close();
            }
            catch ( e ) {

            }
            this.releaseConnection(connection);
        }
        return result;
    },
    /**
     * Issue a read query and return the first column of the first/only row returned.
     *
     * Typically this is used with a query of the form "SELECT COUNT(*) FROM table WHERE ..."
     *
     * @method getScalar
     * @param query
     * @return {*}
     */
    getScalar         : function ( query ) {
        var row = this.getDataRow(query);
        for ( var i in row ) {
            return row[ i ];
        }
        return undefined;
    },
    insertId: function() {
        return this.getScalar('SELECT LASTVAL()');
    },

    /**
     * Begin a transaction
     *
     * @method startTransaction
     * @example
     SQL.startTransaction();
     try {
            // both these need to succeed or the database is corrupt!
            SQL.update(someScaryQuery);
            SQL.update(anotherScaryQuery);
            // success!
            SQL.commit();
        }
     catch (e) {
            SQL.rollback(); // undo any damage
            throw e;
        }
     */
    startTransaction  : function () {
        this.update('BEGIN');
    },
    /**
     * Commit a transaction
     *
     * @method commit
     * @example
     SQL.startTransaction();
     try {
            // both these need to succeed or the database is corrupt!
            SQL.update(someScaryQuery);
            SQL.update(anotherScaryQuery);
            // success!
            SQL.commit();
        }
     catch (e) {
            SQL.rollback(); // undo any damage
            throw e;
        }
     */
    commit            : function () {
        this.update('COMMIT');
    },
    /**
     * Rollback a transaction
     *
     * @method rollback
     * @example
     SQL.startTransaction();
     try {
            // both these need to succeed or the database is corrupt!
            SQL.update(someScaryQuery);
            SQL.update(anotherScaryQuery);
            // success!
            SQL.commit();
        }
     catch (e) {
            SQL.rollback(); // undo any damage
            throw e;
        }
     */
    rollback          : function () {
        this.update('ROLLBACK');
    },
    /**
     * Quote and escape a string to be used as part of a query.
     *
     * The string is surrounded with single quotes and anything in the string that needs to be escaped is escaped.
     *
     * @method quote
     * @param {string} s the string to quote/escape
     * @return {string} the quoted string
     */
    quote             : function ( s ) {
        if ( isArray(s) ) {
            var ret = [];
            decaf.each(s, function ( e ) {
                ret.push(MySQL.prototype.quote(e));
            });
            return ret;
        }
        else if ( s === null || s === undefined ) {
            return 'NULL';
        }
        else if ( s === true || s == 'yes' ) {
            return "'1'";
        }
        else if ( s === false || s == 'no' ) {
            return "'0'";
        }
        else {
            s = s === undefined ? '' : s;
            return "'" + addslashes(s) + "'";
        }
    }
});

decaf.extend(exports, {
    PosgreSQL : PosgreSQL
});
