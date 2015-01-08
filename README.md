decaf-postgresql
================

[PostgreSQL](http://www.postgresql.org/) interface for [decafjs](https://github.com/decafjs).

To use this extension, first create a PostgreSQL database with UTF8 encoding:

    createdb --encoding=utf8 mydb

PostgreSQL constructor config options:

    var PostgreSQL = require('decaf-postgresql').PostgreSQL,
    sql = new PostgreSQL({
        user     : 'postgres',
        password : '',
        database : 'mydb'
    });

The user, password, and database arguments are required. All of the (options supported by PostgreSQL)[http://jdbc.postgresql.org/documentation/93/connect.html] are also supported.

See the examples directory for more information.

