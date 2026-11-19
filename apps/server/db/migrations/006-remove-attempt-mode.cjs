exports.up = async function up(knex) {
  await knex.schema.alterTable('attempts', table => {
    table.dropColumn('mode');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('attempts', table => {
    table.text('mode').notNullable().defaultTo('guided');
    table.check("mode in ('baseline', 'guided')", [], 'attempts_mode_check');
  });
};
