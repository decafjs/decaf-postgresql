/** @module Schema */
/*global require, SQL, req, exports, Server, toString */

"use strict";

var {Thread} = require('Threads');


function isString(s) {
    return typeof s === 'string';
}
function isArray(a) {
    return toString.apply(a) === '[object Array]';
}
function isFunction(f) {
    return toString.apply(f) === '[object Function]';
}
function quoteName(s) {
    return '"' + s + '"';
}
function empty(o) {
    return o === undefined;
}

/**
 * @example
 * <p>A schema is a JavaScript object that describes a database table.  The metadata
 * about the table fields can be more extensive than what SQL allows.  For example,
 * a field can be marked to be removed from an existing / result object so it can
 * safely be sent to the browser.  Or a function can be provided to validate a field's
 * value.</p>
 *
 * <p>Required members of a schema object are:</p>
 * <ul>
 * <li>name {string} name of schema (and database table)</li>
 * <li>fields {array} array of field definitions (see below)</li>
 * </ul>
 * <p>Optional members of a schema object are:</p>
 * <ul>
 * <li>primaryKey {string} a field name or field names separated by comma</li>
 * <li>engine {string} database engine (defualts to InnoDB)</li>
 * <li>indexes {array} indexes to be created for the table,
 * field name or names separated by comma per index</li>
 * <li>onCreate {function} optional function to call when table is created
 *
 * <p>Required members of a field definition are:</p>
 * <ul>
 * <li>name {string} name of field (database column)</li>
 * <li>type {string} type of field (SQL type, eg. 'int' or 'varchar'...)</li>
 * <li>size {int} required only if type is varchar</li>
 * </ul>
 * <p>Optional members of a field definition are:</p>
 * <ul>
 * <li>defaultValue {object} default value of the field, as when a new record is created</li>
 * <li>autoIncrement {boolean} true if this is an auto_increment field</li>
 * <li>ALL OTHER members are ignored at this time</li>
 * </ul>
 * <p>An example Schema definition:</p>
 * <pre>
 *  Schema.add({
     *		name: 'UserGroups',
     *		fields: [
     *			{ name: 'userGroupId', type: 'int', autoIncrement: true, defaultValue: 0 },
     *			{ name: 'groupName', type: 'varchar', size: 64, defaultValue: '' },
     *			{ name: 'isAdmin', type: 'tinyint', size: 1, defaultValue: 0 }
     *		],
     *		primaryKey: 'userGroupId',
     *		engine: 'InnoDB',
     *		onCreate: function() {
     *			Schema.putOne('UserGroups', {
     *				userGroupId: 0,
     *				groupName: 'Administrators',
     *				isAdmin: 1
     *			});
     *			Schema.putOne('UserGroups', {
     *				userGroupId: 0,
     *				groupName: 'Standard',
     *				isAdmin: 0
     *			});
     *		}
     *	});
 * </pre>
 */
var Schema = function () {
    var schemas = {};
    var onStartFuncs = [];


    /** @private */
    function getSchema(name) {
        if (isString(name)) {
            var schema = schemas[name];
            if (!schema) {
                throw new Error('No such schema ' + name);
            }
            return schema;
        }
        return name;
    }

    /**
     * get an appropriate defaultValue for given field
     * if defaultValue present in field, use it
     * otherwise return something appropriate to the field's type
     *
     * @private
     */
    function defaultValue(field) {
        if (field.defaultValue) {
            if (isFunction(field.defaultValue)) {
                return field.defaultValue();
            }
            return field.defaultValue;
        }
        switch (field.type) {
            case 'int':
                return 0;
            case 'tinyint':
                return 0;
            default:
                return '';
        }
    }

    /**
     * Query a Schema for a row or rows by example
     *
     * @method find
     * @param {object} name name of Schema OR a Schema object
     * @param {object} example example to query
     * @param {boolean} single true to return a single row, otherwise all matching rows
     * @return {object} A single row matching example, or all matching rows
     * @private
     */
    function find(name, example, single) {
        var schema = getSchema(name);
        name = schema.name;
        example = example || {};
        var where = Schema.where(name, example);
        var query = [
            'SELECT',
            '       *',
            'FROM',
            '       ' + quoteName(name)
        ];
        if (where.length) {
            query.push('WHERE');
            query.push(where.join(' AND '));
        }
        if (single) {
            var ret = SQL.getDataRow(query);
            return empty(ret) ? [] : Schema.onLoad(schema, ret);
        }
        else {
            return Schema.onLoad(schema, SQL.getDataRows(query));
        }
    }

    /** @private **/
    // onCreate functions are called at onStart time to assure all the tables
    // are created first.
    function onStart() {
        decaf.each(onStartFuncs, function (func) {
            func();
        });
    }

    //Server.addOnStart({name: 'Schemas', func: onStart});
    builtin.atStart(onStart);

    /** @scope Schema */
    return {
        /**
         * <p>Get all schemas in ExtJS DataStore/Record format.</p>
         *
         * @method getSchemaExtJs
         */
        getSchemaExtJs : function () {
            var extjs = {};
            decaf.each(schemas, function (schema) {
                var fields = [];
                decaf.each(schema.fields, function (field) {
                    var type = field.type;
                    switch (field.type) {
                        case 'int':
                            type = 'int';
                            break;
                        case 'tinyint':
                            type = 'int';
                            break;
                        default:
                            type = undefined;
                            break;
                    }
                    var f = decaf.extend({}, field);
                    f.type = type;
                    fields.push(f);
                });
                extjs[schema.name] = {
                    name       : schema.name,
                    fields     : fields,
                    primaryKey : schema.primaryKey
                };
            });
            return extjs;
        },

        /**
         * <p>Add a schema</p>
         *
         * <p>If the database table for the schema does not exist, it is
         * created.</p>
         *
         * @method add
         * @param {object} schema schema definition
         * @return {void} nothing
         */
        add : function (schema) {
            var name = schema.name;
            schemas[name] = schema;

            if (schema.primaryKey) {
                decaf.each(schema.fields, function (field) {
                    if (field.name === schema.primaryKey) {
                        schema.primaryKeyField = field;
                        return false;
                    }
                });
            }

            // this try/catch determines if the table exists in the database
            try {
                //SQL.getDataRow('SHOW CREATE TABLE ' + name);
                SQL.getDataRow('SELECT ' + quoteName(name) + '::regclass');
                // doesn't exist, create it
                Schema.create(name);
            }
            catch (e) {
                try {
                    Schema.change(name);
                }
                catch (e) {
                    console.log(e);
                }
            }
        },

        /**
         * <p>Define an abstract schema</p>
         *
         * <p>Abstract schemas are meant to be extended to create a schema
         * that is represented in the database.</p>
         *
         * @see Schema#extend
         *
         * @method define
         * @param {object} schema abstract schema definition
         */
        define : function (schema) {
            var name = schema.name;
            schemas[name] = schema;
        },

        /**
         * <p>Extend (inherit from) an existing schema</p>
         *
         * <p>Typically an abstract schema is extended.</p>
         *
         * @method extend
         * @param {object} name name of base schema (or schema) to extend
         * @param {object} child fields to extend base schema with
         * @return {void} nothing
         */
        extend : function (name, child) {
            var schema = getSchema(name);
            // TODO don't concat reserved fields
            child.fields = schema.fields.concat(child.fields);
            child.primaryKey = schema.primaryKey;
            if (child.indexes && schema.indexes) {
                child.indexes = schema.indexes.concat(child.indexes);
            }
            Schema.add(child);
        },

        /**
         * Determine if database table for a schema exists
         *
         * @method exists
         * @param {string} name name of database table (and schema)
         * @return {boolean} true if table exists, false otherwise
         */
        exists : function (name) {
            try {
                //SQL.getDataRow('SHOW CREATE TABLE ' + name);
                SQL.getDataRow('SELECT ' + quoteName(name) + '::regclass');
                return true;
            }
            catch (e) {
                return false;
            }
        },

        /**
         * Get a schema by name
         *
         * @method getSchema
         * @param name name of schema
         */
        getSchema : function (name) {
            return getSchema(name);
        },

        /**
         * Get an empty/new record for a schema
         * Merges in an example, if provided.
         *
         * @method newRecord
         * @param {object} name name of schema or schema proper
         * @param {object} example optional example to merge
         * @return {object} record with default values
         */
        newRecord : function (name, example) {
            var schema = getSchema(name);
            var record = {};
            decaf.each(schema.fields, function (field) {
                if (!field.reserved && !field.clientOnly) {
                    record[field.name] = defaultValue(field);
                }
            });
            return decaf.extend(record, example || {});
        },

        /**
         * Clean a record.
         * Removes fields marked clean: true in the schema from the record.
         *
         * @method clean
         * @param {string} name of Schema
         * @param {object} record record to clean
         * @return {object} record with fields removed
         */
        clean : function (name, record) {
            var schema = getSchema(name);
            decaf.each(schema.fields, function (field) {
                if (field.serverOnly) {
                    delete record[field.name];
                }
            });
            return record;
        },

        /**
         * <p>Prepare a string to be used as a sql function in Schema.where().</p>
         *
         * @method fn
         * @param {string} fn the sql function
         * @return {string} the prepared string
         */
        fn : function (fn) {
            return '=' + fn;
        },

        /**
         * <p>Generate a WHERE clause for SQL query based upon an example.
         * An array of "table.key=value" strings is returned, which can be concatonated
         * with another result of this function to generate WHERE clauses for JOIN
         * type queries.  The values are SQL quoted proper.  If a value contains a %,
         * then LIKE is generated.</p>
         *
         * @method where
         * @param {string/object} name name of schema or schema proper
         * @param {object} example example to generate WHERE clause for
         * @return {object} array of "table.key=value"
         */
        where : function (name, example) {
            var schema = getSchema(name);
            name = schema.name;
            var where = [];
            decaf.each(schema.fields, function (field) {
                if (!field.noQuery && !field.reserved && !field.clientOnly && example[field.name] !== undefined) {
                    var value = example[field.name];
                    if (isString(value) && value.indexOf('=') === 0) {
                        where.push(['   ', quoteName(value.substr(1).replace(field.name, name + '.' + field.name))].join(''));
                    }
                    else if (isString(value) && value.indexOf('%') !== -1) {
                        where.push(['   ', quoteName(name, '.', field.name), ' LIKE ', SQL.quote(value)].join(''));
                    }
                    else if (isArray(value)) {
                        if (value.length) {
                            where.push(['	', quoteName(name, '.', field.name), ' IN (', SQL.quote(value), ')'].join(''));
                        }
                    }
                    else {
                        where.push(['   ', quoteName(name, '.', field.name), '=', SQL.quote(value)].join(''));
                    }
                }
            });
            return where;
        },

        /**
         * Return count of records in schema based on example
         *
         * @method count
         * @param {object} name name of schema or schema
         * @param {object} example example to count
         * @return {int} count of records matching example
         */
        count : function (name, example) {
            var schema = getSchema(name);
            name = schema.name;
            example = example || {};
            var where = Schema.where(name, example);
            var query = [
                'SELECT',
                '       COUNT(*)',
                'FROM',
                '       ' + quoteName(name)
            ];
            if (where.length) {
                query.push('WHERE');
                query.push(where.join(' AND '));
            }
            return SQL.getScalar(query);
        },

        /**
         *
         * @method onLoad
         * @param name
         * @param example
         * @return {*}
         */
        onLoad : function (name, example) {
            var schema = getSchema(name);
            if (!isArray(example)) {
                if (schema.onLoad) {
                    schema.onLoad(example);
                }
            }
            else {
                decaf.each(example, function (ex) {
                    if (schema.onLoad) {
                        schema.onLoad(ex);
                    }
                });
            }
            return example;
        },

        /**
         *
         * @method onPut
         * @param name
         * @param example
         * @return {*}
         */
        onPut : function (name, example) {
            var schema = getSchema(name);
            if (!isArray(example)) {
                if (schema.onPut) {
                    schema.onPut(example);
                }
            }
            else {
                decaf.each(example, function (ex) {
                    if (schema.onPut) {
                        schema.onPut(ex);
                    }
                });
            }
            return example;
        },

        /**
         * Query a schema for multiple records by example
         *
         * @method find
         * @param {object} name name of a schema or a schema proper
         * @param {object} example example to query
         * @return {object} all matching rows from the database
         */
        find : function (name, example) {
            return find(name, example, false);
        },

        /**
         * Query a schema for a single record by example
         *
         * @method findOne
         * @param {object} name name of a schema or a schema proper
         * @param {object} example example to query
         * @return {object} a single row from the database
         */
        findOne : function (name, example) {
            return find(name, example, true);
        },

        /**
         * <p>Get a list for ExtJS grid</p>
         *
         * <p>Note: if fn is provided, it will be called for each record in the returned list with
         * the record as the only argument.</p>
         *
         * @method list
         * @param {object} name name of schema or schema struct
         * @param {object} example
         * @param {function} fn optional function called to add information to each record
         * @return {object} object suitable for sending as JSON for ExtJS DataStores.
         *
         */
        list : function (name, example, fn) {
            var req = Thread.currentThread().req; // this.req;
            example = example || {};
            var schema = getSchema(name);
            name = schema.name;

            var startRow = req.data.start || 0;
            var maxRows = req.data.limit || 25;
            var sort = req.data.sort || schema.primaryKey;
            var dir = req.data.dir || 'ASC';

            var where = Schema.where(name, example);
            var query = [
                'SELECT',
                '       COUNT(*)',
                'FROM',
                '       ' + quoteName(name)
            ];
            if (where.length) {
                query.push('WHERE');
                query.push(where.join(' AND '));
            }
            var count = SQL.getScalar(query);
            query[1] = '	*';
            query = query.concat([
                'ORDER BY',
                '	' + quoteName(sort) + ' ' + dir,
                'LIMIT',
                '	' + startRow + ',' + maxRows
            ]);
            var items = SQL.getDataRows(query);
            if (fn) {
                decaf.each(items, fn);
            }
            return {
                count : count,
                list  : items
            };
        },

        /**
         * <p>Store a record in the database</p>
         *
         * <p>This function will insert a new record or update an existing record.</p?
         *
         * <p>If the record is new, the example is merged with default values so a complete
         * record is created.  The primary key in the returned record is set to the insert_id
         * generated by the query.</p>
         *
         * <p>If the record exists, the example is merged with the existing record and updated
         * in the database.</p>
         *
         * @method putOne
         * @param {object} schema name of schema or schema proper
         * @param {object} example full or partial record to store in the database
         * @return {object} complete record as stored in the database.
         */
        putOne       : function (schema, example) {
            schema = getSchema(schema);
            var name = schema.name;
            var primaryKey = (schema.primaryKey && schema.primaryKey.indexOf(',') === -1) ? schema.primaryKey : undefined;

            example = Schema.newRecord(schema, example);
            example = Schema.onPut(schema, example);

            var primaryKeyField = schema.primaryKeyField;
            if (primaryKeyField) {
                if (primaryKeyField.autoIncrement) {
                    example[primaryKeyField.name] = parseInt('' + example[primaryKeyField.name], 10);
                    if (example[primaryKeyField.name]) {
                        var updates = [];
                        decaf.each(schema.fields, function (field) {
                            updates.push(quoteName(field.name) + '=' + SQL.quote(example[field.name]));
                        });
                        var where = ' where ' + quoteName(schema.primaryKey) + '"=' + SQL.quote(example[schema.primaryKey]);
                        SQL.update('update ' + quoteName(schema.name) + ' SET ' + updates.join(',') + where);
                    }
                    else {
                        var keys = [], values = [];
                        decaf.each(schema.fields, function (field) {
                            if (!field.reserved && !field.clientOnly && field.name !== primaryKey) {
                                keys.push(quoteName(field.name));
                                values.push(SQL.quote(example[field.name]));
                            }
                        });
                        debugger;
                        SQL.update('INSERT INTO "' + name + '" (' + keys.join(',') + ') VALUES (' + values.join(',') + ')');
                    }
                }
            }
            if (primaryKey && !example[primaryKey]) {
                example[primaryKey] = SQL.insertId();
            }
            return Schema.onLoad(schema, example);
        },
        /**
         * <p>Remove one or more records from the database.</p>
         *
         * @method remove
         * @param {string} name name of schema or schema proper.
         * @param {object} example example of record(s) to remove from database.
         * @return {int} number of rows removed
         */
        remove       : function (name, example) {
            var where = Schema.where(name, example);
            if (!where.length) {
                throw new Error('Invalid example provided to remove function');
            }
            example = Schema.onPut(example);
            var query = [
                'DELETE',
                'FROM',
                '       ' + quoteName(name)
            ];
            query.push('WHERE');
            query.push(where.join(' AND '));
            return SQL.update(query);
        },
        /**
         * Create a database table from a schema
         *
         * @method create
         * @param {string} name name of schema or schema proper
         * @param {boolean} drop (optional) true to first drop table
         * @return {void} nothing
         */
        create       : function (name, drop) {
            var schema = getSchema(name);
            if (drop) {
                SQL.update('DROP TABLE IF EXISTS ' + quoteName(schema.name));
            }
            var query = [
                'CREATE TABLE ' + quoteName(name) + ' ('
            ];
            var primaryKey = null;
            decaf.each(schema.fields, function (field) {
                if (!field.reserved && !field.clientOnly) {
                    if (field.autoIncrement) {
                        primaryKey = field.name;
                        query.push('	' + quoteName(field.name) + ' ' + 'serial,'); // field.type + ' auto_increment,');
                    }
                    else if (field.type === 'varchar') {
                        query.push('	' + quoteName(field.name) + ' varchar(' + field.size + '),');
                    }
                    else {
                        query.push('	' + quoteName(field.name) + ' ' + field.type + ',');
                    }
                }
            });
            if (schema.primaryKey) {
                query.push('	Primary Key(' + quoteName(schema.primaryKey) + ')');
            }
            else if (primaryKey) {
                query.push('	Primary Key(' + quoteName(primaryKey) + ')');
            }
            else {
                var len = query.length - 1;
                query[len] = query[len].replace(/,$/, '');
            }
            query.push(')');
            SQL.update(query);
            if (schema.indexes) {
                decaf.each(schema.indexes, function (index) {
                    SQL.update('CREATE INDEX ' + quoteName(name + '_' + index) + ' ON ' + quoteName(name) + '(' + index + ')');
                });
            }
            if (schema.onCreate) {
                onStartFuncs.push(schema.onCreate);
                //schema.onCreate();
            }
        },
        /**
         * <p>Generate a Schema definition from an existing database table.</p>
         *
         * @method getFromTable
         * @param {string} name of database table
         * @return {object} Schema definition
         */
        getFromTable : function (name) {
            var schema = {
                name : name
            };

            // OMG does this blow!
            // primary key is found in show indexes results in MySQL
            var primaryKey = SQL.getScalar([
                'select',
                //'   tc.table_schema, tc.table_name, kc.column_name',
                '   kc.column_name',
                'from',
                '   information_schema.table_constraints tc,',
                '   information_schema.key_column_usage kc',
                'where',
                "   tc.constraint_type = 'PRIMARY KEY'",
                '   and kc.table_name = tc.table_name and kc.table_schema = tc.table_schema',
                '   and kc.constraint_name = tc.constraint_name',
                '   and tc.table_name = ' + SQL.quote(name)
            ]);
            schema.primaryKey = primaryKey;

            var fields = [];
            var rows = SQL.getDataRows([
                'select',
                '   column_name, udt_name, column_default, character_maximum_length',
                'from',
                '   INFORMATION_SCHEMA.COLUMNS',
                'where',
                '   table_name = ' + SQL.quote(name)
            ]);
            decaf.each(rows, function (row) {
                var type = row.udt_name,
                    size = row.character_maximum_length;

                if (type === 'int4') {
                    type = 'int';
                }
                if (row.column_default === null) {
                    row.column_default = undefined;
                }
                if (row.column_default && row.column_default.indexOf('nextval') !== -1) {
                    fields.push({
                        name          : row.column_name,
                        type          : type,
                        size          : size,
                        autoIncrement : true,
                        defaultValue  : 0
                    });
                }
                else {
                    fields.push({
                        name         : row.column_name,
                        type         : type,
                        size         : size,
                        defaultValue : row.column_default
                    });
                }
                if (row.column_name === primaryKey) {
                    schema.primaryKeyFIeld = fields[fields.length-1];
                }
            });
            schema.fields = fields;

            //debugger;
            // OMG does this blow!
            // MySQL equivalent: show indexes in table_name
            rows = SQL.getDataRows([
                'select',
                '   t.relname as table_name,',
                '   i.relname as index_name,',
                '   a.attname as column_name',
                'from',
                '   pg_class t,',
                '   pg_class i,',
                '   pg_index ix,',
                '   pg_attribute a',
                'where',
                '   t.oid = ix.indrelid',
                '   and i.oid = ix.indexrelid',
                '   and a.attrelid = t.oid',
                '   and a.attnum = ANY(ix.indkey)',
                "   and t.relkind = 'r'",
                '   and t.relname = ' + SQL.quote(name),
                'order by',
                '   t.relname,',
                '   i.relname'
            ]);
            //rows = SQL.getDataRows('SHOW INDEXES IN ' + name);
            var indexArray = [];
            decaf.each(rows, function (row) {
                if (row.index_name.indexOf('_pkey') === 0) {
                    indexArray.push(row.column_name);
                }
            });
            if (indexArray.length) {
                schema.indexes = indexArray;
            }
            return schema;
        },
        /**
         * Compare a schema with what's actually in the database and issue all alter table type
         * statements required to make the database match the schema.
         *
         * @method change
         * @param name
         */
        change       : function (name) {
            var schema = getSchema(name);

            // table exists, alter the table if necessary
            var existing = Schema.getFromTable(name);

            function fieldTypeCompare(srcField, dstField) {
                if (srcField.type === dstField.type) {
                    if (srcField.type === 'varchar') {
                        return parseInt(srcField.size, 10) === parseInt(dstField.size, 10);
                    }
                    else if (srcField.type === 'int') {
                        if (srcField.autoIncrement === dstField.autoIncrement) {
                            return true;
                        }
                    }
                    else {
                        return true;
                    }
                }
                return false;
            }

            function changeField(srcField, dstField) {
                var query;

                if (dstField.name !== srcField.name) {
                    SQL.update([
                        'ALTER TABLE',
                        '	' + quoteName(name),
                        'RENAME COLUMN',
                        '   ' + quoteName(dstField.name),
                        'TO',
                        '   ' + quoteName(srcField.name)
                    ]);
                }
                query = [
                    'ALTER TABLE',
                    '	' + quoteName(name),
                    'ALTER COLUMN',
                    '   ' + quoteName(dstField.name),
                    'SET DATA TYPE'
                ];
                if (srcField.autoIncrement) {
                    query.push('	' + 'serial');
                }
                else if (srcField.type === 'varchar') {
                    query.push('	' + 'varchar(' + srcField.size + ')');
                }
                else {
                    query.push('	' + srcField.type);
                }
                SQL.update(query);
            }

            function addField(field) {
                var query = [
                    'ALTER TABLE',
                    '	' + quoteName(name),
                    'ADD'
                ];
                if (field.autoIncrement) {
                    query.push('	' + quoteName(field.name) + ' ' + 'serial');
                }
                else if (field.type === 'varchar') {
                    query.push('	' + quoteName(field.name) + ' varchar(' + field.size + ')');
                }
                else {
                    query.push('	' + quoteName(field.name) + ' ' + field.type);
                }
                SQL.update(query);
                // initialize new field with default value in all records:
                SQL.update('update ' + quoteName(name) + ' SET ' + quoteName(field.name) + '=' + SQL.quote(defaultValue(field)));
            }

            // index source fields
            var srcFields = {};
            decaf.each(schema.fields, function (field) {
                if (!field.reserved && !field.clientOnly) {
                    srcFields[field.name] = field;
                }
            });

            // index destination fields
            var dstFields = {};
            decaf.each(existing.fields, function (field) {
                dstFields[field.name] = field;
            });
            function findDstField(srcField) {
                for (var i in dstFields) {
                    if (fieldTypeCompare(srcField, dstFields[i])) {
                        return dstFields[i];
                    }
                }
                return false;
            }

            var fieldsProcessed = {};
            // match up schema fields with existing fields and process them
            decaf.each(srcFields, function (srcField) {
                var dstField = dstFields[srcField.name];
                if (dstField) {
                    // there is a field in the schema with same name as in the database
                    if (!fieldTypeCompare(srcField, dstField)) { // srcField.type !== dstField.type) {
                        // need to alter the table/field type
                        changeField(srcField, dstField);
                    }
                    delete dstFields[srcField.name];
                    fieldsProcessed[srcField.name] = srcField;
                }
            });

            // look at remaining schema fields to see if existing fields are being renamed
            decaf.each(srcFields, function (srcField) {
                if (fieldsProcessed[srcField.name]) {
                    return;
                }
                var dstField = findDstField(srcField);
                if (dstField) {
                    // rename existing field
                    changeField(srcField, dstField);
                    delete dstFields[dstField.name];
                    fieldsProcessed[srcField.name] = srcField;
                }
            });

            // remove remaining destination fields
            decaf.each(dstFields, function (dstField) {
                SQL.update([
                    'ALTER TABLE',
                    '	' + name,
                    'DROP',
                    '	' + quoteName(dstField.name)
                ]);
            });

            // add any remaining source fields
            decaf.each(srcFields, function (srcField) {
                if (fieldsProcessed[srcField.name]) {
                    return;
                }
                addField(srcField);
            });

            // TODO is this logic proper SQL statements? (from here down)
            if (existing.primaryKey && !schema.primaryKey) {
                SQL.update([
                    'ALTER TABLE',
                    '   ' + quoteName(name),
                    'DROP',
                    '   PRIMARY KEY'
                ]);
            }
            else if (schema.primaryKey && !existing.primaryKey) {
                SQL.update([
                    'ALTER TABLE',
                    '   ' + quoteName(name),
                    'ADD',
                    '   PRIMARY KEY (' + quoteName(schema.primaryKey) + ')'
                ]);
            }
            else if (schema.primaryKey !== existing.primaryKey) {
                SQL.update([
                    'ALTER TABLE',
                    '   ' + quoteName(name),
                    'DROP',
                    '   PRIMARY KEY'
                ]);
                SQL.update([
                    'ALTER TABLE',
                    '   ' + quoteName(name),
                    'ADD',
                    '   PRIMARY KEY (' + quoteName(schema.primaryKey) + ')'
                ]);
            }

            var existingIndexes = {};
            if (existing.indexes) {
                decaf.each(existing.indexes, function (index) {
                    existingIndexes[index] = true;
                });
            }
            var newIndexes = [];
            if (schema.indexes) {
                decaf.each(schema.indexes, function (index) {
                    if (existingIndexes[index]) {
                        delete existingIndexes[index];
                    }
                    else {
                        newIndexes.push(index);
                    }
                });
            }
            // delete old indexes not in the schema
            decaf.each(existingIndexes, function (tf, index) {
                SQL.update('ALTER TABLE DROP INDEX ' + quoteName(index.replace(/,/g, '_')));
            });
            decaf.each(newIndexes, function (index) {
                SQL.update('ALTER TABLE ' + quoteName(name) + ' ADD INDEX ' + quoteName(index.replace(/,/g, '_')) + ' (' + quoteName(index) + ')');
            });
        }

    };
}();

decaf.extend(exports, {
    Schema : Schema
});

