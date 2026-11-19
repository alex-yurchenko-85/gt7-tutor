exports.up = async function up(knex) {
  await knex.schema.alterTable('references', table => {
    table.integer('timer_ms');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('references', table => {
    table.dropColumn('timer_ms');
  });
};
