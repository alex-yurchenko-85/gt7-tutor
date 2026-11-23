exports.up = async function up(knex) {
  await knex.schema.alterTable('exercises', table => {
    table.double('side_cue_distance_m').defaultTo(null).alter();
  });
};

exports.down = async function down(knex) {
  await knex.schema.alterTable('exercises', table => {
    table.double('side_cue_distance_m').defaultTo(2).alter();
  });
};
