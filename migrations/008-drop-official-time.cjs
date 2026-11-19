exports.up = async function up(knex) {
  await knex.schema.alterTable('attempts', table => {
    table.dropColumn('official_ms');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('attempts', table => {
    table.integer('official_ms');
  });
};
