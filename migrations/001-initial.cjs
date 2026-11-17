const uuidKey = (knex, table) => table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
const createdAt = (knex, table) => table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

exports.up = async function up(knex) {
  await knex.schema.createTable('users', table => {
    uuidKey(knex, table);
    table.text('name').notNullable().unique();
    table.text('password_hash').notNullable();
    createdAt(knex, table);
  });

  await knex.schema.createTable('sessions', table => {
    uuidKey(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.text('token_hash').notNullable().unique();
    table.timestamp('expires_at', { useTz: true }).notNullable();
    createdAt(knex, table);
    table.index(['user_id']);
  });

  await knex.schema.createTable('settings', table => {
    table.text('key').primary();
    table.jsonb('value').notNullable();
    createdAt(knex, table);
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('catalogue_entries', table => {
    table.text('id').primary();
    table.text('family').notNullable();
    table.text('collection').notNullable();
    table.text('code');
    table.text('name').notNullable();
    table.text('track');
    table.text('circuit_id');
    table.text('car');
    table.jsonb('targets');
    table.jsonb('sections');
    table.text('source').notNullable();
    table.text('support').notNullable().defaultTo('unverified');
    createdAt(knex, table);
    table.check("support in ('verified', 'unverified')", [], 'catalogue_entries_support_check');
    table.index(['family', 'collection']);
  });

  await knex.schema.createTable('exercises', table => {
    uuidKey(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.text('catalogue_id').references('id').inTable('catalogue_entries').onDelete('RESTRICT');
    table.text('family').notNullable();
    table.text('name').notNullable();
    table.integer('car_id');
    table.jsonb('conditions').notNullable().defaultTo('{}');
    table.jsonb('targets').notNullable().defaultTo('{}');
    table.jsonb('muted_cues').notNullable().defaultTo('[]');
    table.uuid('active_reference_id');
    createdAt(knex, table);
    table.index(['user_id']);
    table.index(['catalogue_id']);
  });

  await knex.schema.createTable('captures', table => {
    uuidKey(knex, table);
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('RESTRICT');
    table.uuid('exercise_id').references('id').inTable('exercises').onDelete('RESTRICT');
    table.text('purpose').notNullable();
    table.text('raw_path').notNullable();
    table.timestamp('started_at', { useTz: true }).notNullable();
    table.timestamp('ended_at', { useTz: true });
    table.integer('packets').notNullable().defaultTo(0);
    table.boolean('complete').notNullable().defaultTo(false);
    table.text('error_reason');
    table.double('start_cue_mono_ms');
    createdAt(knex, table);
    table.check("purpose in ('demo', 'player')", [], 'captures_purpose_check');
    table.index(['user_id']);
    table.index(['exercise_id']);
  });

  await knex.schema.createTable('references', table => {
    uuidKey(knex, table);
    table.uuid('exercise_id').notNullable().references('id').inTable('exercises').onDelete('RESTRICT');
    table.uuid('capture_id').notNullable().references('id').inTable('captures').onDelete('RESTRICT');
    table.integer('first_raw_index').notNullable();
    table.integer('last_raw_index').notNullable();
    table.text('origin').notNullable();
    table.text('start_kind').notNullable();
    table.text('game_version');
    table.boolean('needs_check').notNullable().defaultTo(false);
    createdAt(knex, table);
    table.check('first_raw_index >= 0 and last_raw_index >= first_raw_index', [], 'references_range_check');
    table.check("origin in ('demo', 'attempt')", [], 'references_origin_check');
    table.check("start_kind in ('standing', 'flying')", [], 'references_start_kind_check');
    table.index(['exercise_id']);
    table.index(['capture_id']);
  });

  await knex.schema.alterTable('exercises', table => {
    table.foreign('active_reference_id').references('id').inTable('references').onDelete('SET NULL');
  });

  await knex.schema.createTable('attempts', table => {
    uuidKey(knex, table);
    table.uuid('exercise_id').notNullable().references('id').inTable('exercises').onDelete('RESTRICT');
    table.uuid('capture_id').notNullable().references('id').inTable('captures').onDelete('RESTRICT');
    table.uuid('reference_id').notNullable().references('id').inTable('references').onDelete('RESTRICT');
    table.integer('first_raw_index').notNullable();
    table.integer('last_raw_index').notNullable();
    table.text('mode').notNullable();
    table.text('completion').notNullable();
    table.text('reason');
    table.double('measured_ms');
    table.integer('official_ms');
    table.text('medal');
    table.timestamp('started_at', { useTz: true }).notNullable();
    createdAt(knex, table);
    table.check('first_raw_index >= 0 and last_raw_index >= first_raw_index', [], 'attempts_range_check');
    table.check("mode in ('baseline', 'guided')", [], 'attempts_mode_check');
    table.check("completion in ('complete', 'aborted')", [], 'attempts_completion_check');
    table.check("medal is null or medal in ('bronze', 'silver', 'gold')", [], 'attempts_medal_check');
    table.index(['exercise_id', 'started_at']);
    table.index(['reference_id']);
    table.index(['capture_id']);
  });

  await knex.schema.createTable('cue_events', table => {
    uuidKey(knex, table);
    table.uuid('attempt_id').notNullable().references('id').inTable('attempts').onDelete('CASCADE');
    table.text('event_key').notNullable();
    table.text('kind').notNullable();
    table.integer('target_kph');
    table.double('decided_mono_ms').notNullable();
    table.text('outcome').notNullable();
    table.double('start_delay_ms');
    createdAt(knex, table);
    table.index(['attempt_id']);
  });

  await knex.schema.createTable('attempt_findings', table => {
    uuidKey(knex, table);
    table.uuid('attempt_id').notNullable().references('id').inTable('attempts').onDelete('CASCADE');
    table.uuid('reference_id').notNullable().references('id').inTable('references').onDelete('CASCADE');
    table.text('kind').notNullable();
    table.text('event_key');
    table.double('s_m').notNullable();
    table.double('size').notNullable();
    table.text('unit').notNullable();
    createdAt(knex, table);
    table.check("unit in ('m', 'km/h')", [], 'attempt_findings_unit_check');
    table.index(['attempt_id', 'reference_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('attempt_findings');
  await knex.schema.dropTable('cue_events');
  await knex.schema.dropTable('attempts');
  await knex.schema.alterTable('exercises', table => {
    table.dropForeign(['active_reference_id']);
  });
  await knex.schema.dropTable('references');
  await knex.schema.dropTable('captures');
  await knex.schema.dropTable('exercises');
  await knex.schema.dropTable('catalogue_entries');
  await knex.schema.dropTable('settings');
  await knex.schema.dropTable('sessions');
  await knex.schema.dropTable('users');
};
