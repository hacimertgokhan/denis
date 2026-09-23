/*
 * Denis SQL — the query language of Denis tables.
 *
 * A pragmatic subset of standard SQL with MySQL/SQLite flavoured lexing:
 * keywords are case-insensitive, strings may use '...' or "...", identifiers
 * may be quoted with backticks. Everything is one statement per line.
 */
grammar DenisSql;

options { caseInsensitive = true; }

parse
    : statement SEMI? EOF
    ;

statement
    : createTable
    | dropTable
    | alterTable
    | createIndex
    | dropIndex
    | insertStatement
    | selectStatement
    | updateStatement
    | deleteStatement
    | truncateTable
    | showTables
    | showIndexes
    | describeTable
    | explainStatement
    ;

// ---------------------------------------------------------------- DDL

createTable
    : CREATE TABLE (IF NOT EXISTS)? name=identifier LPAREN tableElement (COMMA tableElement)* RPAREN
    ;

tableElement
    : columnDef
    | tableConstraint
    ;

columnDef
    : identifier typeName? columnConstraint*
    ;

typeName
    : identifier (LPAREN INTEGER_LITERAL (COMMA INTEGER_LITERAL)? RPAREN)?
    ;

columnConstraint
    : PRIMARY KEY AUTOINCREMENT?          # pkConstraint
    | NOT NULL                            # notNullConstraint
    | NULL                                # nullConstraint
    | UNIQUE                              # uniqueConstraint
    | DEFAULT defaultValue                # defaultConstraint
    ;

defaultValue
    : literal
    | MINUS number=(INTEGER_LITERAL | DECIMAL_LITERAL)
    | LPAREN literal RPAREN
    ;

tableConstraint
    : PRIMARY KEY LPAREN identifier RPAREN   # tablePk
    | UNIQUE LPAREN identifier RPAREN        # tableUnique
    ;

dropTable
    : DROP TABLE (IF EXISTS)? identifier
    ;

alterTable
    : ALTER TABLE identifier ADD COLUMN? columnDef
    ;

createIndex
    : CREATE UNIQUE? INDEX (IF NOT EXISTS)? indexName=identifier ON table=identifier LPAREN column=identifier RPAREN
    ;

dropIndex
    : DROP INDEX (IF EXISTS)? indexName=identifier (ON table=identifier)?
    ;

truncateTable
    : TRUNCATE TABLE? identifier
    ;

showTables
    : SHOW TABLES
    ;

showIndexes
    : SHOW (INDEXES | INDEX) (FROM | ON) identifier
    ;

describeTable
    : (DESCRIBE | DESC) identifier
    ;

explainStatement
    : EXPLAIN (selectStatement | updateStatement | deleteStatement)
    ;

// ---------------------------------------------------------------- DML

insertStatement
    : (INSERT | REPLACE | UPSERT) (OR REPLACE)? INTO identifier (LPAREN identifier (COMMA identifier)* RPAREN)?
      VALUES valuesRow (COMMA valuesRow)*
    ;

valuesRow
    : LPAREN expr (COMMA expr)* RPAREN
    ;

updateStatement
    : UPDATE identifier SET assignment (COMMA assignment)* (WHERE where=expr)? (LIMIT limit=expr)?
    ;

assignment
    : identifier EQ expr
    ;

deleteStatement
    : DELETE FROM identifier (WHERE where=expr)? (LIMIT limit=expr)?
    ;

selectStatement
    : SELECT DISTINCT? selectItem (COMMA selectItem)*
      (FROM tableRef joinClause*)?
      (WHERE where=expr)?
      (GROUP BY groupItems+=expr (COMMA groupItems+=expr)*)?
      (HAVING having=expr)?
      (ORDER BY orderItem (COMMA orderItem)*)?
      (LIMIT limit=expr ((OFFSET | COMMA) offset=expr)?)?
    ;

selectItem
    : STAR                                  # allColumns
    | identifier DOT STAR                   # tableColumns
    | expr (AS? alias=identifier)?          # exprColumn
    ;

tableRef
    : identifier (AS? alias=identifier)?
    ;

joinClause
    : (INNER | LEFT OUTER? | CROSS)? JOIN tableRef (ON expr)?
    ;

orderItem
    : expr (ASC | DESC)?
    ;

// ---------------------------------------------------------------- expressions
// Alternatives are listed from the tightest to the loosest binding operator.

expr
    : literal                                                            # literalExpr
    | functionCall                                                       # functionExpr
    | columnRef                                                          # columnExpr
    | LPAREN expr RPAREN                                                 # parenExpr
    | CASE (WHEN when+=expr THEN then+=expr)+ (ELSE otherwise=expr)? END # caseExpr
    | op=(MINUS | PLUS) expr                                             # unaryExpr
    | left=expr op=(STAR | SLASH | PERCENT) right=expr                   # mulExpr
    | left=expr op=(PLUS | MINUS) right=expr                             # addExpr
    | left=expr CONCAT right=expr                                        # concatExpr
    | left=expr op=(EQ | NEQ | LT | LTE | GT | GTE) right=expr           # compareExpr
    | expr NOT? IN LPAREN expr (COMMA expr)* RPAREN                      # inExpr
    | expr NOT? BETWEEN low=expr AND high=expr                           # betweenExpr
    | expr NOT? LIKE pattern=expr                                        # likeExpr
    | expr IS NOT? NULL                                                  # isNullExpr
    | NOT expr                                                           # notExpr
    | left=expr AND right=expr                                           # andExpr
    | left=expr OR right=expr                                            # orExpr
    ;

functionCall
    : name=identifier LPAREN (STAR | DISTINCT? expr (COMMA expr)*)? RPAREN
    ;

columnRef
    : (table=identifier DOT)? column=identifier
    ;

literal
    : INTEGER_LITERAL     # integerLiteral
    | DECIMAL_LITERAL     # decimalLiteral
    | STRING_LITERAL      # stringLiteral
    | TRUE                # trueLiteral
    | FALSE               # falseLiteral
    | NULL                # nullLiteral
    | PARAM               # paramLiteral
    ;

identifier
    : IDENTIFIER
    | QUOTED_IDENTIFIER
    | nonReserved
    ;

// Keywords that are still usable as table, column or function names.
nonReserved
    : KEY | INDEXES | TABLES | COLUMN | TRUNCATE | UPSERT | REPLACE | AUTOINCREMENT | OFFSET | EXPLAIN | SHOW
    | DESCRIBE | ADD | END | IF
    ;

// ---------------------------------------------------------------- lexer

ADD           : 'ADD';
ALTER         : 'ALTER';
AND           : 'AND';
AS            : 'AS';
ASC           : 'ASC';
AUTOINCREMENT : 'AUTOINCREMENT' | 'AUTO_INCREMENT';
BETWEEN       : 'BETWEEN';
BY            : 'BY';
CASE          : 'CASE';
COLUMN        : 'COLUMN';
CREATE        : 'CREATE';
CROSS         : 'CROSS';
DEFAULT       : 'DEFAULT';
DELETE        : 'DELETE';
DESC          : 'DESC';
DESCRIBE      : 'DESCRIBE';
DISTINCT      : 'DISTINCT';
DROP          : 'DROP';
ELSE          : 'ELSE';
END           : 'END';
EXISTS        : 'EXISTS';
EXPLAIN       : 'EXPLAIN';
FALSE         : 'FALSE';
FROM          : 'FROM';
GROUP         : 'GROUP';
HAVING        : 'HAVING';
IF            : 'IF';
IN            : 'IN';
INDEX         : 'INDEX';
INDEXES       : 'INDEXES';
INNER         : 'INNER';
INSERT        : 'INSERT';
INTO          : 'INTO';
IS            : 'IS';
JOIN          : 'JOIN';
KEY           : 'KEY';
LEFT          : 'LEFT';
LIKE          : 'LIKE';
LIMIT         : 'LIMIT';
NOT           : 'NOT';
NULL          : 'NULL';
OFFSET        : 'OFFSET';
ON            : 'ON';
OR            : 'OR';
ORDER         : 'ORDER';
OUTER         : 'OUTER';
PRIMARY       : 'PRIMARY';
REPLACE       : 'REPLACE';
SELECT        : 'SELECT';
SET           : 'SET';
SHOW          : 'SHOW';
TABLE         : 'TABLE';
TABLES        : 'TABLES';
THEN          : 'THEN';
TRUE          : 'TRUE';
TRUNCATE      : 'TRUNCATE';
UNIQUE        : 'UNIQUE';
UPDATE        : 'UPDATE';
UPSERT        : 'UPSERT';
VALUES        : 'VALUES';
WHEN          : 'WHEN';
WHERE         : 'WHERE';

EQ      : '=' | '==';
NEQ     : '!=' | '<>';
LTE     : '<=';
GTE     : '>=';
LT      : '<';
GT      : '>';
PLUS    : '+';
MINUS   : '-';
STAR    : '*';
SLASH   : '/';
PERCENT : '%';
CONCAT  : '||';
LPAREN  : '(';
RPAREN  : ')';
COMMA   : ',';
DOT     : '.';
SEMI    : ';';
PARAM   : '?';

INTEGER_LITERAL : [0-9]+;
DECIMAL_LITERAL : [0-9]+ '.' [0-9]* ([E] [+-]? [0-9]+)? | '.' [0-9]+ ([E] [+-]? [0-9]+)? | [0-9]+ [E] [+-]? [0-9]+;

// '...' with '' as an escaped quote; "..." is also a string (MySQL default mode)
STRING_LITERAL
    : '\'' ( ~['\\] | '\'\'' | '\\' . )* '\''
    | '"' ( ~["\\] | '""' | '\\' . )* '"'
    ;

QUOTED_IDENTIFIER : '`' ( ~'`' | '``' )+ '`';
IDENTIFIER        : [A-Z_] [A-Z_0-9]*;

LINE_COMMENT  : '--' ~[\r\n]* -> skip;
BLOCK_COMMENT : '/*' .*? '*/' -> skip;
WS            : [ \t\r\n]+ -> skip;

// anything else becomes a token the parser rejects with a clear message
UNEXPECTED_CHAR : .;
