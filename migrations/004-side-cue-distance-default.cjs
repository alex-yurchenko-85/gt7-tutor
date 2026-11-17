exports.up = async function up(knex) {
  await knex.raw('ALTER TABLE exercises ALTER COLUMN side_cue_distance_m SET DEFAULT 2');
  await knex('exercises').where({ side_cue_distance_m: 1 }).update({ side_cue_distance_m: 2 });
};

exports.down = async function down(knex) {
  await knex.raw('ALTER TABLE exercises ALTER COLUMN side_cue_distance_m SET DEFAULT 1');
};
