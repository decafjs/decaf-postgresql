/**
 * Created by mschwartz on 12/15/14.
 */

/*global require */

// note you have to change user to your name for this to work!
var PostgreSQL = require('decaf-postgresql').PostgreSQL,
    sql = new PostgreSQL({
        user     : 'mschwartz',
        password : '',
        database : 'mydb'
    });

console.dir(sql.getDataRows('select * from version()'));
