exports.up = async function up(knex) {
  await knex.schema.createTable('attempt_comparisons', table => {
    table.uuid('attempt_id').notNullable().references('id').inTable('attempts').onDelete('CASCADE');
    table.uuid('reference_id').notNullable().references('id').inTable('references').onDelete('CASCADE');
    table.primary(['attempt_id', 'reference_id']);
  });
  await knex.raw('insert into attempt_comparisons (attempt_id, reference_id) select distinct attempt_id, reference_id from attempt_findings');
};

exports.down = async function down(knex) {
  await knex.schema.dropTable('attempt_comparisons');
};
