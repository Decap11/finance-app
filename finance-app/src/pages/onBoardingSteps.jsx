import { useState } from "react";
import "../styles/onBoardingSteps.css";
const stepsData = [
  {
    title: "Save, invest in shares and change your financial life",
    illustration: "/src/assets/step-1- illustration.png",
  },
  {
    title: "Track your expenses and manage your budget",
    illustration: "/src/assets/step-2 illustration.png",
  },
  {
    title: "Grow your wealth with smart investments",
    illustration: "/src/assets/step-3 illustration.png",
  },
];
export default function OnBoardingSteps() {
  const [step, setStep] = useState(1);

  function handleNext() {
    if (step < 3) setStep(step + 1);
  }
  function handlePrev() {
    if (step > 1) setStep(step - 1);
  }
  return (
    <div className="app-container onboarding-page">
      <div className="steps-indicator">
        <div className={`step ${step >= 1 ? "active" : ""}`}>1</div>
        <div className={`step ${step >= 2 ? "active" : ""}`}>2</div>
        <div className={`step ${step >= 3 ? "active" : ""}`}>3</div>
      </div>

      <div className="step-content">
        <h1 className="step-title">{stepsData[step - 1].title}</h1>

        <div className="illustration-container">
          <img
            src={stepsData[step - 1].illustration}
            alt="Save and invest illustration"
            className="step-illustration"
          />
        </div>
      </div>

      <div className="bottom-controls">
        <a
          href="#"
          className="btn btn-primary"
          id="prevBtn"
          onClick={handlePrev}
        >
          Previous
        </a>
        <a
          href="#"
          className="btn btn-primary"
          id="nextBtn"
          onClick={handleNext}
        >
          Next
        </a>
      </div>
    </div>
  );
}
