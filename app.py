import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from sentence_transformers import SentenceTransformer, util

app = Flask(__name__)
CORS(app)

# Memory Optimization: Load the lightweight model explicitly on CPU
# 'all-MiniLM-L6-v2' is highly efficient and fits well within 512MB RAM
print("Loading model on CPU...")
model = SentenceTransformer('all-MiniLM-L6-v2', device='cpu')

@app.route('/get-score', methods=['POST'])
def get_score():
    try:
        data = request.get_json()
        
        if not data or 'model_answer' not in data or 'student_answer' not in data:
            return jsonify({"error": "Missing model_answer or student_answer"}), 400
        
        model_answer = data['model_answer']
        student_answer = data['student_answer']
        
        # Encode answers into semantic vectors
        # convert_to_tensor=True uses PyTorch tensors for faster util.cos_sim
        embeddings1 = model.encode(model_answer, convert_to_tensor=True)
        embeddings2 = model.encode(student_answer, convert_to_tensor=True)
        
        # Calculate Cosine Similarity
        cosine_score = util.cos_sim(embeddings1, embeddings2)
        
        # Extract raw score and scale to 0.0 - 10.0
        # Similarity is typically 0-1 for positive text matches
        raw_score = float(cosine_score[0][0])
        final_score = max(0.0, min(10.0, raw_score * 10.0))
        
        return jsonify({
            "score": round(final_score, 2),
            "status": "success"
        })
        
    except Exception as e:
        print(f"Error processing request: {str(e)}")
        return jsonify({"error": "Internal server error", "details": str(e)}), 500

if __name__ == '__main__':
    # Render dynamic port assignment
    port = int(os.environ.get("PORT", 5000))
    app.run(host='0.0.0.0', port=port)
