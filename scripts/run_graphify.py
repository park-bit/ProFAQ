import json
import pathlib
from graphify.detect import detect
from graphify.extract import collect_files, extract
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json

root = pathlib.Path('.').resolve()
out_dir = root / 'graphify-out'
out_dir.mkdir(exist_ok=True)

# 1. Detect
print("Step 1: Detecting files...")
detect_res = detect(root)
(out_dir / '.graphify_detect.json').write_text(json.dumps(detect_res, ensure_ascii=False), encoding='utf-8')
print(f"Total files: {detect_res['total_files']}, code: {len(detect_res.get('files', {}).get('code', []))}")

# 2. Extract AST
print("Step 2: Extracting AST for code files...")
code_files = []
for f in detect_res.get('files', {}).get('code', []):
    p = pathlib.Path(f)
    code_files.extend(collect_files(p) if p.is_dir() else [p])

ast_res = extract(code_files, cache_root=root)
(out_dir / '.graphify_ast.json').write_text(json.dumps(ast_res, indent=2, ensure_ascii=False), encoding='utf-8')
print(f"AST: {len(ast_res['nodes'])} nodes, {len(ast_res['edges'])} edges")

# Semantic: empty for code
(out_dir / '.graphify_semantic.json').write_text(json.dumps({'nodes': [], 'edges': [], 'hyperedges': [], 'input_tokens': 0, 'output_tokens': 0}), encoding='utf-8')

# Merge
extract_data = {
    'nodes': ast_res['nodes'],
    'edges': ast_res['edges'],
    'hyperedges': [],
    'input_tokens': 0,
    'output_tokens': 0,
}
(out_dir / '.graphify_extract.json').write_text(json.dumps(extract_data, indent=2, ensure_ascii=False), encoding='utf-8')

# 3. Build graph & cluster
print("Step 3: Building graph and clustering...")
G = build_from_json(extract_data, root=str(root), directed=False)
communities = cluster(G)
cohesion = score_all(G, communities)
gods = god_nodes(G)
surprises = surprising_connections(G, communities)

labels = {cid: f"Community {cid}" for cid in communities}
questions = suggest_questions(G, communities, labels)

to_json(G, communities, str(out_dir / 'graph.json'), community_labels=labels)
tokens = {'input': 0, 'output': 0}
report = generate(G, communities, cohesion, labels, gods, surprises, detect_res, tokens, str(root), suggested_questions=questions)
(out_dir / 'GRAPH_REPORT.md').write_text(report, encoding='utf-8')

analysis = {
    'communities': {str(k): v for k, v in communities.items()},
    'cohesion': {str(k): v for k, v in cohesion.items()},
    'gods': gods,
    'surprises': surprises,
    'questions': questions,
}
(out_dir / '.graphify_analysis.json').write_text(json.dumps(analysis, indent=2, ensure_ascii=False), encoding='utf-8')

print(f"Graph built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges, {len(communities)} communities")
print("Done! Outputs in graphify-out/")
