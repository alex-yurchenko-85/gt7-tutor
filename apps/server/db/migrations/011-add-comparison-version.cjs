exports.up = async function up(knex) {
  await knex.schema.alterTable('attempt_comparisons', table => {
    table.integer('version').notNullable().defaultTo(0);
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('attempt_comparisons', table => {
    table.dropColumn('version');
  });
};
