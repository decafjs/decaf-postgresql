/**
 * Created by mschwartz on 12/15/14.
 */

var PostgreSQL = require('decaf-postgresql').PostgreSQL,
    sql = new PostgreSQL({
        user: 'mschwartz',
        password: '',
        db: 'mydb'
    });

console.dir(sql.getDataRows('select * from version()'));