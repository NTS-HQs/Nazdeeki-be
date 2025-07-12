-- ============================================================================
-- Script to Regenerate Database Schema CSV
-- ============================================================================
-- Run this query to generate an updated str.csv file
-- Copy the output and save it as str.csv

\copy (
    SELECT 
        table_schema,
        table_name,
        ordinal_position,
        column_name,
        data_type,
        is_nullable,
        CASE 
            WHEN tc.constraint_type = 'PRIMARY KEY' THEN 'YES'
            ELSE 'NO'
        END as is_primary_key,
        fk.foreign_table_name as foreign_key_references_table,
        fk.foreign_column_name as foreign_key_references_column
    FROM 
        information_schema.columns c
    LEFT JOIN (
        -- Get primary key information
        SELECT 
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            tc.constraint_type
        FROM 
            information_schema.table_constraints tc
        JOIN 
            information_schema.key_column_usage kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        WHERE 
            tc.constraint_type = 'PRIMARY KEY'
    ) tc ON c.table_schema = tc.table_schema 
        AND c.table_name = tc.table_name 
        AND c.column_name = tc.column_name
    LEFT JOIN (
        -- Get foreign key information
        SELECT
            tc.table_schema,
            tc.table_name,
            kcu.column_name,
            ccu.table_name AS foreign_table_name,
            ccu.column_name AS foreign_column_name
        FROM
            information_schema.table_constraints AS tc
        JOIN 
            information_schema.key_column_usage AS kcu
            ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
        JOIN 
            information_schema.constraint_column_usage AS ccu
            ON ccu.constraint_name = tc.constraint_name
            AND ccu.table_schema = tc.table_schema
        WHERE 
            tc.constraint_type = 'FOREIGN KEY'
    ) fk ON c.table_schema = fk.table_schema 
        AND c.table_name = fk.table_name 
        AND c.column_name = fk.column_name
    WHERE 
        c.table_schema = 'public'
        AND c.table_name IN (
            'addresses', 'admin', 'auth_logs', 'auth_sessions', 'collection', 
            'likes', 'menu', 'order_list', 'orders', 'otp_attempts', 'rating', 
            'seller_services', 'sellers', 'sellers_backup', 'users'
        )
    ORDER BY 
        c.table_name, c.ordinal_position
) TO 'str_updated.csv' WITH CSV HEADER;

-- Alternative version for manual copying (without file output)
-- Uncomment the following if you want to copy the results manually:

/*
SELECT 
    '"' || table_schema || '",' ||
    '"' || table_name || '",' ||
    ordinal_position || ',' ||
    '"' || column_name || '",' ||
    '"' || data_type || '",' ||
    '"' || is_nullable || '",' ||
    '"' || CASE 
        WHEN tc.constraint_type = 'PRIMARY KEY' THEN 'YES'
        ELSE 'NO'
    END || '",' ||
    COALESCE('"' || fk.foreign_table_name || '"', 'NULL') || ',' ||
    COALESCE('"' || fk.foreign_column_name || '"', 'NULL') as csv_line
FROM 
    information_schema.columns c
LEFT JOIN (
    SELECT 
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        tc.constraint_type
    FROM 
        information_schema.table_constraints tc
    JOIN 
        information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    WHERE 
        tc.constraint_type = 'PRIMARY KEY'
) tc ON c.table_schema = tc.table_schema 
    AND c.table_name = tc.table_name 
    AND c.column_name = tc.column_name
LEFT JOIN (
    SELECT
        tc.table_schema,
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
    FROM
        information_schema.table_constraints AS tc
    JOIN 
        information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
    JOIN 
        information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
    WHERE 
        tc.constraint_type = 'FOREIGN KEY'
) fk ON c.table_schema = fk.table_schema 
    AND c.table_name = fk.table_name 
    AND c.column_name = fk.column_name
WHERE 
    c.table_schema = 'public'
    AND c.table_name IN (
        'addresses', 'admin', 'auth_logs', 'auth_sessions', 'collection', 
        'likes', 'menu', 'order_list', 'orders', 'otp_attempts', 'rating', 
        'seller_services', 'sellers', 'sellers_backup', 'users'
    )
ORDER BY 
    c.table_name, c.ordinal_position;
*/ 