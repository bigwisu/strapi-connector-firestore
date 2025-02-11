import type { DocumentData, DocumentReference, FieldPath, Settings, WhereFilterOp } from '@google-cloud/firestore';
import type { Logger } from 'pino';
import type { Transaction } from './db/transaction';
import type { FirestoreConnectorModel } from './model';
import type { PickReferenceKeys, PopulatedByKeys } from './populate';

export interface Connector {
  connector: string
  options: ConnectorOptions
  settings?: Settings
}

export interface ConnectorOptions {

  /**
   * Indicates whether to connect to a locally running
   * Firestore emulator instance.
   * 
   * Defaults to `false`.
   */
  useEmulator?: boolean

  /**
   * Indicates whether or not to log the number of
   * read and write operations for every transaction
   * that is executed.
   * 
   * Defaults to `true` for development environments
   * and `false` otherwise.
   */
  logTransactionStats?: boolean

  /**
   * Indicates whether or not to log the details of
   * every query that is executed.
   * 
   * Defaults to `false`.
   */
  logQueries?: boolean

  /**
   * Designates the document ID to use to store the data
   * for "singleType" models, or when flattening is enabled.
   * 
   * Defaults to `"default"`.
   */
  singleId?: string

  /**
   * Indicate which models to flatten by RegEx. Matches against the
   * model's `uid` property.
   * 
   * Defaults to `false` so that no models are flattened.
   */
  flattenModels?: boolean | string | RegExp | FlattenFn | (string | RegExp | FlattenFn)[]

  /**
   * Globally allow queries that are not Firestore native.
   * These are implemented manually and will have poor performance,
   * and potentially expensive resource usage.
   * 
   * Defaults to `false`.
   */
  allowNonNativeQueries?: boolean | string | RegExp | ModelTestFn | (string | RegExp | ModelTestFn)[]

  /**
   * If `true`, then IDs are automatically generated and assigned to component instances.
   * This setting only applies to component models, and has no effect on other models.
   * 
   * Defaults to `true`.
   */
  ensureComponentIds?: boolean

  /**
   * If defined, enforces a maximum limit on the size of all queries.
   * You can use this to limit out-of-control quota usage.
   * 
   * Does not apply to flattened collections which use only a single
   * read operation anyway.
   * 
   * Defaults to `200`.
   */
  maxQuerySize?: number

  /**
   * The field used to build the field that will store the
   * metadata map which holds the indexes for repeatable and
   * dynamic-zone components.
   * 
   * If it is a string, then it will be combined with the component
   * field as a postfix. If it is a function, then it will be called
   * with the field of the attribute containing component, and the function
   * must return the string to be used as the field.
   * 
   * Defaults to `"$meta"`.
   */
  metadataField?: string | ((attrKey: string) => string)

  /**
   * If defined, then overrides the model that is associated with creator fields
   * such as `"created_by"` and `"updated_by"`.
   * 
   * Defaults to the build-in Strapi Admin user model, i.e.: `{ modelKey: "user", plugin: "admin" }`.
   */
  creatorUserModel?: string | { model: string, plugin?: string }

  /**
   * A hook called before each model is mounted. This can be used to modify any model (particularly useful
   * for builtin or plugin models), before it is loaded into the Firestore connector.
   */
  beforeMountModel?: ((model: StrapiModel) => void | Promise<void>)

  /**
   * A hook called after each model is mounted. Use with caution!
   */
  afterMountModel?: ((model: FirestoreConnectorModel) => void | Promise<void>)
}

export interface ModelOptions<T extends object, R extends DocumentData = DocumentData> extends StrapiModelOptions {
  timestamps?: boolean | [string, string]
  singleId?: string

  /**
   * Override connector option per model.
   * 
   * Defaults to `undefined` (use connector setting).
   */
  logQueries?: boolean

  /**
   * Override connector flattening options per model.
   * `false` to disable.
   * `true` to enable and use connector's `singleId` for the document ID.
   * 
   * Defaults to `undefined` (use connector setting).
   */
  flatten?: boolean


  /**
   * Override connector setting per model.
   * 
   * Defaults to `undefined` (use connector setting).
   */
  allowNonNativeQueries?: boolean

  /**
   * If defined, nominates a single attribute to be searched when fully-featured
   * search is disabled because of the `allowNonNativeQueries` setting.
   */
  searchAttribute?: string

  /**
   * Override connector setting per model. This setting only affects component models.
   * 
   * Defaults to `undefined` (use connector setting).
   */
  ensureComponentIds?: boolean

  /**
   * Override connector setting per model.
   * 
   * Defaults to `undefined` (use connector setting).
   */
  maxQuerySize?: number

  /**
   * Override connector setting per model.
   * 
   * Defaults to `undefined` (use connector setting).
   */
  metadataField?: string | ((attrKey: AttributeKey<T>) => string)

  /**
   * Converter that is run upon data immediately before it
   * is stored in Firestore, and immediately after it is
   * retrieved from Firestore.
   */
  converter?: Converter<T, R>

  /**
   * Override connector setting per model.
   * 
   * Defaults to `undefined` (use connector setting).
   */
  creatorUserModel?: string | { model: string, plugin?: string }

  /**
   * Makes this model a virtual model, with the given object acting as the data source.
   * Virtual models are not stored in Firestore, but the given object acts as the proxy
   * to fetch and store data in it's entirety.
   */
  virtualDataSource?: DataSource<T> | null

  /**
   * A hook that is called inside the transaction whenever an changes. This is called before any change
   * is committed to the database. If an exception is thrown, then the transaction will be aborted.
   * Any additional write created by the hook will be committed atomically with this transaction.
   * 
   * This hook is only called via the query interface (i.e. `strapi.query(...).create(...)` etc). Any operations performed directly using the model's 
   * `runTransaction(...)` interface will bypass this hook.
   * 
   * Note: This hook may be called multiple times for a single transaction, if the transaction is retried. The result
   * of transaction may not necessarily be committed to the database, depending on the success of the transaction.
   * Return a function from this hook, for any code that should be executed only once upon success of the transaction.
   * 
   * @param previousData The previous value of the entity, or `undefined` if the entity is being created.
   * @param newData The new value of the entity, or `undefined` if the entity is being deleted.
   * @param transaction The transaction being run. Can be used to fetch additional entities, or make additional
   *    atomic writes.
   * @returns The hook may optionally return a function, or a Promise that optionally resolves to a function.
   *    If a promise is returned, it will be awaited before completing the transaction.
   *    If it resolves to a function, this function will be called only once, after the transaction has been
   *    successfully committed.
   *    Any errors thrown by this function will be caught and ignored.
   *    
   */
  onChange?: TransactionOnChangeHook<T>
}

export type TransactionOnChangeHook<T> = (previousData: T | undefined, newData: T | undefined, transaction: Transaction) => (void | TransactionSuccessHook<T>) | PromiseLike<void | TransactionSuccessHook<T>>
export type TransactionSuccessHook<T> = (result: T | undefined) => (void | PromiseLike<void>)

export interface DataSource<T extends object> {
  /**
   * Indicates whether entries in this data source will have persistent and stable IDs
   * between server restarts. If `true`, then the connector will allow non-virtual collections
   * to have dominant references to this virtual collection.
   */
  hasStableIds?: boolean
  getData(): { [id: string]: T } | Promise<{ [id: string]: T }>
  setData?(data: { [id: string]: T }): Promise<void>
}

export interface Converter<T, R extends DocumentData = DocumentData> {
  toFirestore?: (data: Partial<T>) => R
  fromFirestore?: (data: R) => T
}

declare global {
  const strapi: Strapi

  interface StrapiModelMap {

  }
}

export interface StrapiContext<T extends object = object> {
  strapi: Strapi
  modelKey: string
  model: FirestoreConnectorModel<T>
}

export interface Strapi {
  config: {
    connections: { [c: string]: Connector }
    hook: any
    appPath: string
  }
  components: StrapiModelRecord
  models: StrapiModelRecord
  contentTypes: { [key: string]: StrapiModel }
  admin: Readonly<StrapiPlugin>
  plugins: { [key: string]: Readonly<StrapiPlugin> }
  db: StrapiDatabaseManager
  connections: { [name: string]: any }
  log: Logger

  getModel(modelKey: string, plugin?: string): Readonly<FirestoreConnectorModel>

  query<K extends keyof StrapiModelMap>(entity: K, plugin?: string): StrapiQuery<StrapiModelMap[K]>
  query(entity: string, plugin?: string): StrapiQuery
}

export type StrapiModelRecord = {
  [modelKey in keyof StrapiModelMap]: Readonly<FirestoreConnectorModel<StrapiModelMap[modelKey]>>
};

export interface StrapiDatabaseManager {
  getModel(name: string, plugin: string | undefined): FirestoreConnectorModel<any> | undefined
  getModelByAssoc(assoc: StrapiAttribute): FirestoreConnectorModel<any> | undefined
  getModelByCollectionName(collectionName: string): FirestoreConnectorModel<any> | undefined
  getModelByGlobalId(globalId: string): FirestoreConnectorModel<any> | undefined
}

export interface StrapiPlugin {
  models: StrapiModelRecord
}


export type AttributeKey<T extends object> = Extract<keyof T, string>;

export interface StrapiQuery<T extends object = DocumentData> {
  model: StrapiModel<T>
  find<K extends PickReferenceKeys<T>>(params?: any, populate?: K[]): Promise<PopulatedByKeys<T, K>[]>
  findOne<K extends PickReferenceKeys<T>>(params?: any, populate?: K[]): Promise<PopulatedByKeys<T, K> | null>
  create<K extends PickReferenceKeys<T>>(values: T, populate?: K[]): Promise<PopulatedByKeys<T, K>>
  update<K extends PickReferenceKeys<T>>(params: any, values: T, populate?: K[]): Promise<PopulatedByKeys<T, K>>
  delete<K extends PickReferenceKeys<T>>(params: any, populate?: K[]): Promise<PopulatedByKeys<T, K> | null | (PopulatedByKeys<T, K> | null)[]>
  count(params?: any): Promise<number>
  search<K extends PickReferenceKeys<T>>(params: any, populate?: K[]): Promise<PopulatedByKeys<T, K>[]>
  countSearch(params: any): Promise<number>
  fetchRelationCounters<K extends PickReferenceKeys<T>>(attribute: K, entitiesIds?: string[]): Promise<RelationCounter[]>
}

export interface RelationCounter {
  id: string
  count: number
}

export interface StrapiModel<T extends object = object> {
  connector: string
  connection: string
  primaryKey: string
  primaryKeyType: StrapiAttributeType
  attributes: { [key: string]: StrapiAttribute }
  privateAttributes: { [key: string]: StrapiAttribute }
  collectionName: string
  kind: 'collectionType' | 'singleType'
  globalId: string
  plugin?: string
  modelName: string
  modelType?: 'contentType' | 'component'
  internal?: boolean
  uid: string
  orm: string
  options?: StrapiModelOptions
  associations: StrapiAssociation<AttributeKey<T>>[]
}

export interface StrapiModelOptions {
  timestamps?: boolean | [string, string]
  populateCreatorFields?: boolean
}

export type StrapiRelationType = 'oneWay' | 'manyWay' | 'oneToMany' | 'oneToOne' | 'manyToMany' | 'manyToOne' | 'oneToManyMorph' | 'manyToManyMorph' | 'manyMorphToMany' | 'manyMorphToOne' | 'oneMorphToOne' | 'oneMorphToMany';
export type StrapiAttributeType = 'integer' | 'float' | 'decimal' | 'biginteger' | 'string' | 'text' | 'richtext' | 'email' | 'enumeration' | 'uid' | 'date' | 'time' | 'datetime' | 'timestamp' | 'json' | 'boolean' | 'password' | 'dynamiczone' | 'component';

export interface StrapiAttribute {
  dominant?: boolean
  via?: string
  model?: string
  collection?: string
  filter?: string
  plugin?: string
  autoPopulate?: boolean
  type?: StrapiAttributeType
  required?: boolean
  component?: string
  components?: string[]
  repeatable?: boolean
  min?: number
  max?: number
  private?: boolean
  configurable?: boolean
  writable?: boolean
  visible?: boolean

  index?: true | string | { [key: string]: true | IndexerFn }
  isMeta?: boolean
}

export interface IndexerFn {
  (value: any, component: object): any
}

export interface FlattenFn<T extends object = any> {
  (model: StrapiModel<T>): string | boolean | DocumentReference | null | undefined
}

export interface ModelTestFn<T extends object = any> {
  (model: StrapiModel<T>): boolean
}

export interface StrapiAssociation<K extends string = string> {
  alias: K
  nature: StrapiRelationType
  autoPopulate: boolean

  /**
   * The `uid` of the target model, or `"*"` if this is
   * polymorphic.
   */
  targetUid: string
  type: 'model' | 'collection'
  collection?: string
  model?: string
  dominant?: boolean
  via?: string
  plugin?: string
  filter?: string
  related?: FirestoreConnectorModel<any>[]
  tableCollectionName?: string
}

export interface StrapiFilter {
  sort?: { field: string, order: 'asc' | 'desc'  }[]
  start?: number,
  limit?: number,
  where?: (StrapiWhereFilter | StrapiOrFilter)[]
}

export type StrapiWhereOperator = 'eq' | 'ne' | 'in' | 'nin' | 'contains' | 'ncontains' | 'containss' | 'ncontainss' | 'lt' | 'lte' | 'gt' | 'gte' | 'null';

export interface StrapiWhereFilter {
  field: string
  operator: StrapiWhereOperator
  value: any
}

export interface StrapiOrFilter {
  field?: null
  operator: 'or'
  value: StrapiWhereFilter[][]
}

export interface FirestoreFilter {
  field: string | FieldPath
  operator: WhereFilterOp
  value: any
}
