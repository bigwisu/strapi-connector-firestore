import * as _ from 'lodash';
import { CoerceOpts, coerceToModel } from '../coerce/coerce-to-model';
import { DeepReference } from '../db/deep-reference';
import { MorphReference } from '../db/morph-reference';
import { NormalReference } from '../db/normal-reference';
import type { Reference, SetOpts } from '../db/reference';
import type { Transaction } from '../db/transaction';
import type { ReadWriteTransaction } from '../db/readwrite-transaction';
import type { ReadOnlyTransaction } from '../db/readonly-transaction';
import { VirtualReference } from '../db/virtual-reference';
import { relationsUpdate, shouldUpdateRelations } from '../relations';

export interface LifecycleArgs<T extends object> extends Required<CoerceOpts> {
  ref: Reference<T>
  data: T | Partial<T> | undefined
  transaction?: ReadWriteTransaction | ReadOnlyTransaction
  opts: SetOpts | undefined
  timestamp: Date
}

/**
 * Runs the full lifecycle on the given reference including coercion and updating relations.
 * @returns The coerced data
 */
export async function runUpdateLifecycle<T extends object>({ ref, data, editMode, opts, timestamp, transaction }: LifecycleArgs<T>): Promise<T | Partial<T> | undefined> {
  const db = ref.parent;
  const newData = data ? coerceToModel(db.model, ref.id, data, null, { editMode, timestamp }) : undefined;

  if (shouldUpdateRelations(opts)) {

    const runUpdateWithRelations = async (trans: Transaction) => {
      const prevData = editMode === 'update'
        ? await trans.getAtomic(ref).then(snap => snap.data())
        : undefined;
      await relationsUpdate(db.model, ref, prevData, newData, editMode, trans);
      (trans as (ReadWriteTransaction | ReadOnlyTransaction)).mergeWriteInternal(ref, newData, editMode);
    };
    
    if (transaction) {
      await runUpdateWithRelations(transaction);
    } else {
      await db.model.runTransaction(runUpdateWithRelations);
    }
  } else {
    if (transaction) {
      transaction.mergeWriteInternal(ref, newData, editMode);
    } else {
      if ((ref instanceof NormalReference)
        || (ref instanceof DeepReference)
        || (ref instanceof MorphReference)
        || (ref instanceof VirtualReference)) {
        await ref.writeInternal(newData, editMode);
      } else {
        throw new Error(`Unknown type of reference: ${ref}`);
      }
    }
  }

  return newData;
}
