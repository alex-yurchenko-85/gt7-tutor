import { Fragment, type ReactNode } from 'react';
import type { MessageKey, Params } from '@gt7/contracts';
import { t } from './i18n.ts';

const MARK = '\u0000';
const MARKED = new RegExp(`${MARK}(\\d+)${MARK}`);

type RichProps = { k: MessageKey; params?: Params; parts: Record<string, ReactNode> };

export function Rich({ k, params, parts }: RichProps) {
  const names = Object.keys(parts);
  const markers = Object.fromEntries(names.map((name, index) => [name, `${MARK}${index}${MARK}`]));
  const pieces = t(k, { ...params, ...markers }).split(MARKED);
  return (
    <>
      {pieces.map((piece, index) => (
        <Fragment key={index}>{index % 2 === 1 ? parts[names[Number(piece)]!] : piece}</Fragment>
      ))}
    </>
  );
}
