export default function CorrectFeedback({ showFireworks = true }) {
  return (
    <>
      {showFireworks && (
        <div className="feedback-fireworks" aria-hidden="true">
          <div className="fireworks" style={{ "--fireworks-x": "50%", "--fireworks-y": "50%" }}>
            <span className="firework firework-one" />
            <span className="firework firework-two" />
            <span className="firework firework-three" />
          </div>
          <div className="confetti">
            {Array.from({ length: 42 }, (_, index) => (
              <span
                key={index}
                style={{
                  left: `${(index * 37) % 100}%`,
                  animationDelay: `${(index % 12) * 0.035}s`,
                  "--fall-duration": `${1.05 + (index % 6) * 0.1}s`,
                  "--confetti-rotation": `${index * 137}deg`,
                }}
              />
            ))}
          </div>
        </div>
      )}
      <strong className="correct-inline-message">✓ Правильно!</strong>
    </>
  );
}
