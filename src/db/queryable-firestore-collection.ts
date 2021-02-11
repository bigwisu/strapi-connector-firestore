import * as _ from 'lodash';
import { ManualFilter, convertWhere, WhereFilter } from '../utils/convert-where';
import { Query, QueryDocumentSnapshot, FieldPath, WhereFilterOp, DocumentData, CollectionReference, FirestoreDataConverter } from '@google-cloud/firestore';
import type { QueryableCollection, QuerySnapshot } from './queryable-collection';
import type { StrapiWhereFilter, StrapiWhereOperator } from '../types';
import type { FirestoreConnectorModel } from '../model';
import { coerceModelToFirestore, coerceToFirestore } from '../coerce/coerce-to-firestore';
import { coerceToModel } from '../coerce/coerce-to-model';
import { makeNormalSnap, NormalReference } from './normal-reference';
import type { ReadRepository } from '../utils/read-repository';
import { mapNotNull } from '../utils/map-not-null';


export class QueryableFirestoreCollection<T extends object = DocumentData> implements QueryableCollection<T> {

  readonly model: FirestoreConnectorModel<T>
  readonly converter: FirestoreDataConverter<T>;
  
  private readonly collection: CollectionReference<T>
  private readonly allowNonNativeQueries: boolean
  private readonly maxQuerySize: number
  private readonly manualFilters: ManualFilter[];
  private query: Query<T>
  private _limit?: number;
  private _offset?: number;

  constructor(other: QueryableFirestoreCollection<T>)
  constructor(model: FirestoreConnectorModel<T>)
  constructor(modelOrOther: FirestoreConnectorModel<T> | QueryableFirestoreCollection<T>) {
    if (modelOrOther instanceof QueryableFirestoreCollection) {
      this.model = modelOrOther.model;
      this.collection = modelOrOther.collection;
      this.converter = modelOrOther.converter;
      this.allowNonNativeQueries = modelOrOther.allowNonNativeQueries;
      this.maxQuerySize = modelOrOther.maxQuerySize;
      this.query = modelOrOther.query;
      this.manualFilters = modelOrOther.manualFilters.slice();
      this._limit = modelOrOther._limit;
      this._offset = modelOrOther._offset;
    } else {
      
      this.model = modelOrOther;
      const {
        toFirestore = (value) => value,
        fromFirestore = (value) => value,
      } = modelOrOther.options.converter;
      this.converter = {
        toFirestore: data => {
          const d = coerceModelToFirestore(modelOrOther, data);
          return toFirestore(d);
        },
        fromFirestore: snap => {
          const d = fromFirestore(snap.data());
          return coerceToModel(modelOrOther, snap.id, d, null, {});
        },
      };

      this.collection = modelOrOther.firestore
        .collection(modelOrOther.collectionName)
        .withConverter(this.converter);

      this.query = this.collection;
      this.allowNonNativeQueries = modelOrOther.options.allowNonNativeQueries;
      this.maxQuerySize = modelOrOther.options.maxQuerySize;
      this.manualFilters = [];
      
      if (this.maxQuerySize < 0) {
        throw new Error("maxQuerySize cannot be less than zero");
      }
    }
  }


  
  get path() {
    return this.collection.path;
  }

  autoId() {
    return this.collection.doc().id;
  }

  doc(): NormalReference<T>;
  doc(id: string): NormalReference<T>;
  doc(id?: string) {
    const doc = id ? this.collection.doc(id.toString()) : this.collection.doc();
    return new NormalReference(doc, this);
  }


  private warnQueryLimit(limit: number | 'unlimited') {
    const msg = 
      `The query limit of "${limit}" has been capped to "${this.maxQuerySize}".` +
      'Adjust the strapi-connector-firestore \`maxQuerySize\` configuration option ' +
      'if this is not the desired behaviour.';

    if (limit === 'unlimited') {
      // Log at debug level if no limit was set
      strapi.log.debug(msg);
    } else {
      // Log at warning level if a limit was explicitly
      // set beyond the maximum limit
      strapi.log.warn(msg);
    }
  }

  async get(trans?: ReadRepository): Promise<QuerySnapshot<T>> {
    // Ensure the maximum limit is set if no limit has been set yet
    let q: QueryableFirestoreCollection<T> = this;
    if (this.maxQuerySize && (this._limit === undefined)) {
      // Log a warning when the limit is applied where no limit was requested
      this.warnQueryLimit('unlimited');
      q = q.limit(this.maxQuerySize);
    }

    const docs = q.manualFilters.length
      ? await queryWithManualFilters(q.query, q.manualFilters, q._limit || 0, q._offset || 0, trans)
      : await (trans ? trans.getQuery(q.query) : q.query.get()).then(snap => snap.docs);


    return {
      empty: docs.length === 0,
      docs: docs.map(s => {
        const ref = this.doc(s.id);
        return makeNormalSnap(ref, s);
      }),
    };
  }

  where(filter: StrapiWhereFilter | WhereFilter): QueryableFirestoreCollection<T>
  where(field: string | FieldPath, operator: WhereFilterOp | StrapiWhereOperator, value: any): QueryableFirestoreCollection<T>
  where(fieldOrFilter: string | FieldPath | StrapiWhereFilter | WhereFilter, operator?: WhereFilterOp | StrapiWhereOperator, value?: any): QueryableFirestoreCollection<T> {
    if ((typeof fieldOrFilter === 'string') || (fieldOrFilter instanceof FieldPath)) {
      const filter = convertWhere(this.model, fieldOrFilter, operator!, value, this.allowNonNativeQueries ? 'preferNative' : 'nativeOnly');
      if (!filter) {
        return this;
      }
      const other = new QueryableFirestoreCollection(this);
      if (typeof filter === 'function') {
        other.manualFilters.push(filter);
      } else {
        // Convert the value for Firestore-native query
        const value = coerceToFirestore(filter.value);
        other.query = this.query.where(filter.field, filter.operator, value);
      }
      return other;
    } else {
      return this.where(fieldOrFilter.field, fieldOrFilter.operator, fieldOrFilter.value);
    }
  }

  whereAny(filters: (StrapiWhereFilter | WhereFilter)[]): QueryableFirestoreCollection<T> {
    if (!this.allowNonNativeQueries) {
      throw new Error('OR filters and search are not natively supported by Firestore. Use the `allowNonNativeQueries` option to enable manual search, or `searchAttribute` to enable primitive search.');
    }
    const other = new QueryableFirestoreCollection(this);
    const filterFns = mapNotNull(
      filters,
      ({ field, operator, value }) => {
        return convertWhere(this.model, field, operator, value, 'manualOnly');
      }
    );
    other.manualFilters.push(data => filterFns.some(f => f(data)));
    return other;
  }

  orderBy(field: string | FieldPath, directionStr: "desc" | "asc" = 'asc'): QueryableFirestoreCollection<T> {
    const other = new QueryableFirestoreCollection(this);
    other.query = this.query.orderBy(field, directionStr);
    return other;
  }

  limit(limit: number): QueryableFirestoreCollection<T> {
    if (this.maxQuerySize && (this.maxQuerySize < limit)) {
      // Log a warning when a limit is explicitly requested larger
      // than than the configured limit
      this.warnQueryLimit(limit);
      limit = this.maxQuerySize;
    }

    const other = new QueryableFirestoreCollection(this);
    other.query = this.query.limit(limit);
    other._limit = limit;
    return other;
  }

  offset(offset: number): QueryableFirestoreCollection<T> {
    const other = new QueryableFirestoreCollection(this);
    other.query = this.query.offset(offset);
    return other;
  }
}


async function* queryChunked<T extends object>(query: Query<T>, chunkSize:number, transaction: ReadRepository | undefined) {
  let cursor: QueryDocumentSnapshot<T> | undefined
  while (true) {
    let q = query.limit(chunkSize);
    if (cursor) {
      // WARNING:
      // Usage of a cursor implicitly applies field ordering by document ID
      // and this can cause queries to fail
      // E.g. inequality filters require the first sort field to be the same
      // field as the inequality filter (see issue #29)
      // This scenario only manifests when manual queries are used
      q = q.startAfter(cursor);
    }

    const { docs } = await (transaction ? transaction.getQuery(q) : q.get());
    cursor = docs[docs.length - 1];

    for (const d of docs) {
      yield d;
    }

    if (docs.length < chunkSize) {
      return;
    }
  }
}

async function queryWithManualFilters<T extends object>(query: Query<T>, filters: ManualFilter[], limit: number, offset: number, transaction: ReadRepository | undefined): Promise<QueryDocumentSnapshot<T>[]> {

  // Use a chunk size of 10 for the native query
  // E.g. if we only want 1 result, we will still query
  // ten at a time to improve performance for larger queries
  // But it will increase read usage (at most 9 reads will be unused)
  const chunkSize = Math.max(10, limit);

  // Improve performance by performing some native offset
  const q = query.offset(offset);

  const docs: QueryDocumentSnapshot<T>[] = [];

  for await (const doc of queryChunked(q, chunkSize, transaction)) {
    if (filters.every(op => op(doc))) {
      if (offset) {
        offset--;
      } else {
        docs.push(doc);
        if (docs.length >= limit) {
          break;
        }
      }
    }
  }

  return docs;
}