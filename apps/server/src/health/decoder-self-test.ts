import { decode } from '@gt7/core';

const INTERLAGOS_PACKET_BASE64 =
  '1/PzZ3ygZEwNdjvzRhT9sQlZOgWhHiHjQUZZDMGklz1JbtWPzgNPk+xbhli2EaDVaIgVbDZuwiCG00TaFv0XBOnVGqx5btmc07pp5cXwdWwsE+VOndnxmFB7Fh8iWzrPyoRuvalsjQH5GXfW7y/nc6gd2KxxUqNrcFA2vsgcbmxcWFDVF2dMVztKI17JN99GD6QvzfoqgofXvTxcwHb16F6CfyxW+g8eSCsCG3Z6uaK3xP9KO9Ap4zNmo0Lul5xH6hMyZMbXSENsU0TvPkEDK4PITV2Jk9X2hW/ZFZgu3BtgnRotif3DOPNEiAPe19yTpST8qr7mwIdTdTWBYJrB00SjPLLiiHWJN0LENDlUYHOzfZLZqiUOHW3xd4D1UMJDKdq8YVvmP4gdlLbWJobchl5b2OAgJ+L7/4JMES/HcxJOSuxpJULSutreej80Ym+sDD74Tt2wKxljfzWTvfSJgxDBgtKo/4V8lpkLvxadyn4=';
const INTERLAGOS_CAR_ID = 1905;

export function decoderWorks(): boolean {
  const result = decode(new Uint8Array(Buffer.from(INTERLAGOS_PACKET_BASE64, 'base64')));
  return result.ok && result.sample.carId === INTERLAGOS_CAR_ID;
}
