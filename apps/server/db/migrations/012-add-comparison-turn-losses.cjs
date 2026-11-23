exports.up = async function up(knex) {
  await knex.schema.alterTable('attempt_comparisons', table => {
    table.jsonb('turn_losses').notNullable().defaultTo(knex.raw("'[]'::jsonb"));
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('attempt_comparisons', table => {
    table.dropColumn('turn_losses');
  });
  await knex('attempt_comparisons').where('version', '>', 1).update({ version: 1 });
};
