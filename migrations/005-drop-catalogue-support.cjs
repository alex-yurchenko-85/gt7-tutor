exports.up = async function up(knex) {
  await knex.schema.alterTable('catalogue_entries', table => {
    table.dropChecks('catalogue_entries_support_check');
    table.dropColumn('support');
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('catalogue_entries', table => {
    table.text('support').notNullable().defaultTo('unverified');
    table.check("support in ('verified', 'unverified')", [], 'catalogue_entries_support_check');
  });
};
