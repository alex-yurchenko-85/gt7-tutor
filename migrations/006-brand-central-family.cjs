async function renameFamily(knex, from, to) {
  await knex('exercises').where({ family: from }).update({ family: to });
  await knex('catalogue_entries').where({ family: from }).update({ family: to });
}

exports.up = async function up(knex) {
  await renameFamily(knex, 'Brand Experience', 'Brand Central');
};

exports.down = async function down(knex) {
  await renameFamily(knex, 'Brand Central', 'Brand Experience');
};
