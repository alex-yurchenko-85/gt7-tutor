exports.up = async function up(knex) {
  await knex.schema.alterTable('exercises', table => {
    table.boolean('speak_targets').notNullable().defaultTo(true);
    table.jsonb('cue_offsets').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
  });
  await knex.schema.alterTable('cue_events', table => {
    table.double('device_delay_ms');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('cue_events', table => {
    table.dropColumn('device_delay_ms');
  });
  await knex.schema.alterTable('exercises', table => {
    table.dropColumn('cue_offsets');
    table.dropColumn('speak_targets');
  });
};
