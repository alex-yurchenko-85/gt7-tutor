import type { CornerInfo, CornerReview, Difference, TurnLossInfo } from '@gt7/contracts';
import { DEFAULT_CONFIG, attemptLowPoint, outsideM, seriesAt, turnOf, type Corner, type Finding, type Review, type TurnLoss } from '@gt7/core';
import { cornerInfos } from '../references/references.service.js';

export function turnLossInfos(losses: TurnLoss[]): TurnLossInfo[] {
  return losses.map(({ turn, fromSM, toSM, lostMs }) => ({ turn, fromSM, toSM, lostMs }));
}

export function withTurn(finding: Finding, corners: Corner[]): Difference {
  return { ...finding, turn: turnOf(corners, finding.sM) };
}

export function reviewBody(review: Review, findings: Finding[]) {
  const { corners, ...series } = review;
  return { ...series, findings: findings.map(finding => withTurn(finding, corners)), corners: cornerReviews(review) };
}

export function cornerReviews(review: Review): CornerReview[] {
  const infos = cornerInfos(review.corners, review.lengthM);
  return review.corners.map((corner, index) => cornerReview(corner, index, infos[index]!, review));
}

function cornerReview(corner: Corner, index: number, info: CornerInfo, review: Review): CornerReview {
  const lateralM = seriesAt(review.attempt.lat, review.gridM, corner.apexSM);
  const speedMps = seriesAt(review.attempt.v, review.gridM, corner.apexSM);
  const low = corner.lowSpeedSM === null ? null : attemptLowPoint(review, index, DEFAULT_CONFIG);
  return {
    ...info,
    outsideM: lateralM === null ? null : outsideM(corner, lateralM),
    speedMps,
    attemptLowSM: low?.sM ?? null,
    attemptLowMps: low?.speedMps ?? null
  };
}
