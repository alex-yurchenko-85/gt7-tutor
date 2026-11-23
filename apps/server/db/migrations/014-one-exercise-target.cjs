exports.up = async function up(knex) {
  await knex.schema.alterTable('exercises', table => {
    table.integer('target_ms').nullable();
  });
  await knex('exercises').whereRaw("targets->>'goldMs' is not null").update({ target_ms: knex.raw("(targets->>'goldMs')::int") });
  await knex.schema.alterTable('exercises', table => {
    table.dropColumn('targets');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('exercises', table => {
    table.jsonb('targets').notNullable().defaultTo(knex.raw("'{}'::jsonb"));
  });
  await knex('exercises').whereNotNull('target_ms').update({ targets: knex.raw("jsonb_build_object('goldMs', target_ms)") });
  await knex.schema.alterTable('exercises', table => {
    table.dropColumn('target_ms');
  });
};
