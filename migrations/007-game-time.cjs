exports.up = async function up(knex) {
  await knex.schema.alterTable('attempts', table => {
    table.double('game_ms');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('attempts', table => {
    table.dropColumn('game_ms');
  });
};
