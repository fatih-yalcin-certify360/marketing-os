CREATE TABLE visibility_entities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label_id uuid NOT NULL REFERENCES labels(id),
 name text NOT NULL, kind text NOT NULL CHECK(kind IN ('own','competitor')),
 aliases text[] NOT NULL DEFAULT '{}', domains text[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX visibility_one_own ON visibility_entities(label_id) WHERE kind='own';
CREATE TABLE visibility_prompts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label_id uuid NOT NULL REFERENCES labels(id), course_version_id uuid NOT NULL REFERENCES course_versions(id),
 text text NOT NULL, normalized_text text NOT NULL, family text NOT NULL, topic text NOT NULL, intent text NOT NULL, persona text NOT NULL, source text NOT NULL,
 version integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved')), kind text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), approved_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(label_id,course_version_id,normalized_text)
);
CREATE TABLE visibility_benchmarks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), label_id uuid NOT NULL REFERENCES labels(id), course_version_id uuid NOT NULL REFERENCES course_versions(id),
 name text NOT NULL, country text NOT NULL, language text NOT NULL, session_type text NOT NULL, search_mode text NOT NULL, repeats integer NOT NULL CHECK(repeats BETWEEN 1 AND 5),
 entity_snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE visibility_benchmark_prompts (benchmark_id uuid NOT NULL REFERENCES visibility_benchmarks(id),prompt_id uuid NOT NULL REFERENCES visibility_prompts(id), PRIMARY KEY(benchmark_id,prompt_id));
CREATE TABLE visibility_benchmark_engines (benchmark_id uuid NOT NULL REFERENCES visibility_benchmarks(id),engine text NOT NULL,PRIMARY KEY(benchmark_id,engine));
CREATE TABLE visibility_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), benchmark_id uuid NOT NULL REFERENCES visibility_benchmarks(id), created_by uuid NOT NULL REFERENCES users(id),
 request_key uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(benchmark_id,request_key)
);
CREATE TABLE visibility_observations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),run_id uuid NOT NULL REFERENCES visibility_runs(id),prompt_id uuid NOT NULL REFERENCES visibility_prompts(id),engine text NOT NULL,
 repetition integer NOT NULL CHECK(repetition BETWEEN 1 AND 5),status text NOT NULL CHECK(status IN ('success','blocked','unavailable','extraction_error')),
 raw_response text NOT NULL, response_hash text NOT NULL, capture_method text NOT NULL, captured_at timestamptz NOT NULL, model text,
 citation_capture text NOT NULL, failure_reason text NOT NULL, evidence_url text, imported_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(run_id,prompt_id,engine,repetition)
);
CREATE TABLE visibility_mentions (observation_id uuid NOT NULL REFERENCES visibility_observations(id),entity_id uuid NOT NULL REFERENCES visibility_entities(id),evidence text NOT NULL, PRIMARY KEY(observation_id,entity_id));
CREATE TABLE visibility_citations (observation_id uuid NOT NULL REFERENCES visibility_observations(id),url text NOT NULL,domain text NOT NULL, PRIMARY KEY(observation_id,url));
CREATE TABLE visibility_actions (observation_id uuid PRIMARY KEY REFERENCES visibility_observations(id),campaign_id uuid NOT NULL REFERENCES campaigns(id),created_at timestamptz NOT NULL DEFAULT now());
