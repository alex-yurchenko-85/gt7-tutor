exports.up = async function up(knex) {
  await knex.schema.alterTable('references', table => {
    table.dropColumn('start_kind');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('references', table => {
    table.text('start_kind').notNullable().defaultTo('flying');
    table.check("start_kind in ('standing', 'flying')", [], 'references_start_kind_check');
  });
};
