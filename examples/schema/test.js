/**
 * Created by mschwartz on 12/18/14.
 */

var PostgreSQL = require('decaf-postgresql').PostgreSQL,
Schema         = require('decaf-postgresql').Schema;


global.SQL = new PostgreSQL({
    user     : 'mschwartz',
    password : '',
    database : 'test'
});

Schema.add({
    name: 'test',
    fields: [
        { name: 'a', type: 'int', autoIncrement: true },
        { name: 'b', type: 'varchar', size: 10 },
        { name: 'd', type: 'int' },
        { name: 'testCamelCase', type: 'varchar', size: 20 }
    ],
    primaryKey: 'a'
});

debugger;
Schema.putOne('test', {
    b: 'hello',
    c: 11,
    testCamelCase: 'xyzzy'
});

console.dir(Schema.find('test', {}));
