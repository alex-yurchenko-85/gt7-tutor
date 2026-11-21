const rawRange = (table, name) => {
  table.integer('first_raw_index').notNullable();
  table.integer('last_raw_index').notNullable();
  table.check('first_raw_index >= 0 and last_raw_index >= first_raw_index', [], name);
};

exports.up = async function up(knex) {
  await knex.raw('alter table captures drop constraint captures_purpose_check');
  await knex.raw("alter table captures add constraint captures_purpose_check check (purpose in ('demo', 'player', 'race'))");

  await knex.schema.createTable('races', table => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'));
    table.uuid('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    table.uuid('capture_id').notNullable().references('id').inTable('captures').onDelete('NO ACTION');
    rawRange(table, 'races_range_check');
    table.text('track_name');
    table.jsonb('track_candidates').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
    table.integer('car_id').notNullable();
    table.integer('first_lap').notNullable();
    table.integer('laps_in_race').notNullable();
    table.integer('cars').notNullable();
    table.integer('start_position').notNullable();
    table.integer('finish_position').notNullable();
    table.integer('race_ms').notNullable();
    table.integer('best_lap').notNullable();
    table.integer('best_lap_ms').notNullable();
    table.integer('reference_lap').notNullable();
    table.double('lap_length_m');
    table.boolean('complete').notNullable();
    table.jsonb('position_steps').notNullable();
    table.jsonb('fuel_points').notNullable();
    table.jsonb('recurring').notNullable();
    table.timestamp('started_at', { useTz: true }).notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['user_id', 'started_at']);
    table.index(['capture_id']);
  });

  await knex.schema.createTable('race_laps', table => {
    table.uuid('race_id').notNullable().references('id').inTable('races').onDelete('CASCADE');
    table.integer('number').notNullable();
    rawRange(table, 'race_laps_range_check');
    table.integer('time_ms').notNullable();
    table.integer('position_start').notNullable();
    table.integer('position_end').notNullable();
    table.double('top_speed_mps').notNullable();
    table.double('fuel_start').notNullable();
    table.double('fuel_end').notNullable();
    table.boolean('pit_in').notNullable();
    table.boolean('pit_out').notNullable();
    table.unique(['race_id', 'number']);
  });

  await knex.schema.createTable('race_events', table => {
    table.uuid('race_id').notNullable().references('id').inTable('races').onDelete('CASCADE');
    table.text('kind').notNullable();
    table.integer('lap').notNullable();
    table.double('s_m');
    table.double('x').notNullable();
    table.double('z').notNullable();
    table.integer('wheels');
    table.double('duration_ms').notNullable();
    table.double('speed_in_mps');
    table.double('speed_min_mps');
    table.double('fuel_before');
    table.double('fuel_after');
    rawRange(table, 'race_events_range_check');
    table.check("kind in ('off-track', 'pit-stop')", [], 'race_events_kind_check');
    table.index(['race_id']);
  });
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('race_events');
  await knex.schema.dropTable('race_laps');
  await knex.schema.dropTable('races');
  await knex('captures').where({ purpose: 'race' }).delete();
  await knex.raw('alter table captures drop constraint captures_purpose_check');
  await knex.raw("alter table captures add constraint captures_purpose_check check (purpose in ('demo', 'player'))");
};
